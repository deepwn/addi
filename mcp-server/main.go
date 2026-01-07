package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/deepwn/addi/mcp-server/runner"
	"github.com/deepwn/addi/mcp-server/tools"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Version is the current version of the application, set at build time.
var Version = "dev"

//go:embed resources/templates resources/reference/*.md
var templatesFS embed.FS

func main() {
	mode := flag.String("mode", "local", "Execution mode: local, docker, or both")
	dirsFlag := flag.String("dirs", "", "Comma-separated list of directories to scan for tools")
	watchFlag := flag.Bool("watch", false, "Watch for file changes")
	versionFlag := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(Version)
		os.Exit(0)
	}

	execMode := runner.ExecutionMode(*mode)
	if execMode != runner.ModeLocal && execMode != runner.ModeDocker && execMode != runner.ModeBoth {
		fmt.Fprintf(os.Stderr, "Invalid mode: %s. Must be local, docker, or both\n", *mode)
		os.Exit(1)
	}

	// Create a new MCP server
	s := server.NewMCPServer(
		"addi-mcp-server",
		Version,
		server.WithResourceCapabilities(true, true), // Supports resources, supports list_changed
		server.WithLogging(),
		server.WithToolCapabilities(true), // Supports list_changed
	)

	// Tool registry mapping to handle "remove" logic (File Path -> Tool Name)
	// We no longer need the full registry logic as s.ListTools() can be used for counting.
	var (
		fileToToolName = make(map[string]string)
		registryMutex  sync.RWMutex
	)

	// Helper to register/update tool in server and local mapping
	registerTool := func(t tools.ToolDef) {
		registryMutex.Lock()
		fileToToolName[t.File] = t.Name
		registryMutex.Unlock()

		s.AddTool(t.ToMCPTool(), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			// Send log notification using standard helper
			// Note: SendLogMessageToClient sends to a specific client context, but here we want to broadcast or log generally.
			// Since we don't have a specific client session for broadcast logging easily, we construct the notification manually
			// but use the correct structure or helpers if available.
			// For now, sticking to the standard "notifications/message"
			notification := mcp.NewLoggingMessageNotification(
				mcp.LoggingLevelInfo,
				"tool-execution",
				fmt.Sprintf("Executing tool: %s", t.Name),
			)
			// Convert struct to map for SendNotificationToAllClients
			paramsMap := make(map[string]interface{})
			// mcp-go struct tags usually handle this, but to be sure we can marshal/unmarshal or just construct map manually
			// Manual map construction is safer/faster for simple logging
			paramsMap["level"] = notification.Params.Level
			paramsMap["logger"] = notification.Params.Logger
			paramsMap["data"] = notification.Params.Data

			s.SendNotificationToAllClients("notifications/message", paramsMap)

			args, ok := request.Params.Arguments.(map[string]interface{})
			if !ok {
				args = make(map[string]interface{})
			}
			return runner.Execute(ctx, t, args, execMode)
		})
	}

	// Load tools
	var dirs []string
	if *dirsFlag != "" {
		// Split by comma
		dirs = strings.Split(*dirsFlag, ",")
	} else {
		homeDir, _ := os.UserHomeDir()
		dirs = []string{
			filepath.Join(homeDir, ".addi"),
			".addi/public",
			".addi/private",
		}
	}

	loadedTools, err := tools.LoadTools(dirs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading tools: %v\n", err)
	}

	for _, t := range loadedTools {
		registerTool(t)
	}

	// Register resources from configured directories (looking for "resources" subdirectory)
	for _, dir := range dirs {
		resDir := filepath.Join(dir, "resources")
		if err := registerResources(s, resDir); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: Failed to register resources from %s: %v\n", resDir, err)
		}
	}

	// Register embedded templates
	if err := registerEmbeddedResources(s, templatesFS); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: Failed to register embedded resources: %v\n", err)
	}

	// Register built-in tool: addi_server_info
	s.AddTool(mcp.NewTool("addi_server_info",
		mcp.WithDescription("Get information about the Addi MCP server, including version, watched directories, and tool definition format. Use this to understand where to create new tool YAML files."),
	), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {

		// Load built-in template from embedded fs
		templateContent := ""
		if content, err := templatesFS.ReadFile("resources/templates/basic.yaml"); err == nil {
			templateContent = string(content)
		} else {
			templateContent = "# Template error: basic.yaml not found in embedded resources"
		}

		// Also try to list reference docs
		referenceDocs := []string{}
		if entries, err := templatesFS.ReadDir("resources/reference"); err == nil {
			for _, e := range entries {
				referenceDocs = append(referenceDocs, fmt.Sprintf("internal:///resources/reference/%s", e.Name()))
			}
		}

		info := struct {
			Version       string   `json:"version"`
			Mode          string   `json:"mode"`
			Directories   []string `json:"watched_directories"`
			LoadedCount   int      `json:"loaded_tools_count"`
			YamlTemplate  string   `json:"tool_yaml_template"`
			ReferenceDocs []string `json:"reference_docs"`
		}{
			Version:       Version,
			Mode:          string(execMode),
			Directories:   dirs,
			LoadedCount:   len(s.ListTools()),
			YamlTemplate:  templateContent,
			ReferenceDocs: referenceDocs,
		}

		jsonBytes, err := json.MarshalIndent(info, "", "  ")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Failed to marshal info: %v", err)), nil
		}

		return mcp.NewToolResultText(string(jsonBytes)), nil
	})

	// Start watcher if enabled
	if *watchFlag {
		w, err := tools.NewWatcher(dirs)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to start watcher: %v\n", err)
		} else {
			// fmt.Fprintf(os.Stderr, "Watching directories: %v\n", dirs)
			w.Start(func(path string, action string) {
				if action == "remove" {
					// Find tool by file path and remove it from server
					registryMutex.Lock()
					if name, ok := fileToToolName[path]; ok {
						s.DeleteTools(name)
						delete(fileToToolName, path)
						fmt.Fprintf(os.Stderr, "Removed tool: %s (path: %s)\n", name, path)
					}
					registryMutex.Unlock()
				} else {
					// add or update
					t, err := tools.LoadToolFromFile(path)
					if err != nil {
						fmt.Fprintf(os.Stderr, "Error loading tool from %s: %v\n", path, err)
						return
					}
					registerTool(*t)
					fmt.Fprintf(os.Stderr, "Loaded/Updated tool: %s\n", t.Name)
				}

				// Notify clients that tool list has changed
				s.SendNotificationToAllClients(mcp.MethodNotificationToolsListChanged, nil)
				fmt.Fprintf(os.Stderr, "Sent notification: %s\n", mcp.MethodNotificationToolsListChanged)
			})
			defer w.Close()
		}
	}

	// Start the server on stdio
	if err := server.ServeStdio(s); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

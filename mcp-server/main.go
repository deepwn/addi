package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/deepwn/addi/mcp-server/runner"
	"github.com/deepwn/addi/mcp-server/tools"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Version is the current version of the application, set at build time.
var Version = "dev"

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
	s := server.NewMCPServer("addi-mcp-server", Version)

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
		toolDef := t // capture loop variable
		s.AddTool(toolDef.ToMCPTool(), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args, ok := request.Params.Arguments.(map[string]interface{})
			if !ok {
				// Handle case where arguments might be nil or not a map
				args = make(map[string]interface{})
			}
			return runner.Execute(ctx, toolDef, args, execMode)
		})
	}

	// Start watcher if enabled
	if *watchFlag {
		w, err := tools.NewWatcher(dirs)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to start watcher: %v\n", err)
		} else {
			// fmt.Fprintf(os.Stderr, "Watching directories: %v\n", dirs)
			w.Start(func(path string) {
				// fmt.Fprintf(os.Stderr, "Tool file changed: %s\n", path)
				t, err := tools.LoadToolFromFile(path)
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error reloading tool from %s: %v\n", path, err)
					return
				}

				// Re-register tool
				// AddTool in mcp-go typically overwrites if name exists
				s.AddTool(t.ToMCPTool(), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
					args, ok := request.Params.Arguments.(map[string]interface{})
					if !ok {
						args = make(map[string]interface{})
					}
					return runner.Execute(ctx, *t, args, execMode)
				})
				// fmt.Fprintf(os.Stderr, "Reloaded tool: %s\n", t.Name)

				// Notify clients that tool list has changed
				// Since we are using stdio server, we can try to send a notification
				// Construct the JSON-RPC notification
				// Method: notifications/tools/list_changed
				// Params: nil
				notification := `{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}`
				fmt.Println(notification)
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

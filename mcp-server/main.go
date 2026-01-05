package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/deepwn/addi/mcp-server/runner"
	"github.com/deepwn/addi/mcp-server/tools"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	mode := flag.String("mode", "local", "Execution mode: local, docker, or both")
	versionFlag := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println("0.0.1")
		os.Exit(0)
	}

	execMode := runner.ExecutionMode(*mode)
	if execMode != runner.ModeLocal && execMode != runner.ModeDocker && execMode != runner.ModeBoth {
		fmt.Fprintf(os.Stderr, "Invalid mode: %s. Must be local, docker, or both\n", *mode)
		os.Exit(1)
	}

	// Create a new MCP server
	s := server.NewMCPServer("addi-mcp-server", "0.0.1")

	// Load tools
	homeDir, _ := os.UserHomeDir()
	dirs := []string{
		filepath.Join(homeDir, ".addi"),
		".addi/public",
		".addi/private",
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

	// Start the server on stdio
	if err := server.ServeStdio(s); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

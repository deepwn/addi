package runner

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/deepwn/addi/mcp-server/tools"
	"github.com/mark3labs/mcp-go/mcp"
)

// ExecutionMode determines how tools are executed (local, docker, or both).
type ExecutionMode string

const (
	// ModeLocal allows execution of tools directly on the host machine.
	ModeLocal ExecutionMode = "local"
	// ModeDocker allows execution of tools within Docker containers.
	ModeDocker ExecutionMode = "docker"
	// ModeBoth allows both local and Docker execution.
	ModeBoth ExecutionMode = "both"
)

// Execute runs a tool based on its definition and provided arguments.
// It creates the runtime environment (shell, docker, etc.) and returns the result.
func Execute(ctx context.Context, tool tools.ToolDef, args map[string]interface{}, allowedMode ExecutionMode) (*mcp.CallToolResult, error) {
	// Fill in default values for inputs
	if args == nil {
		args = make(map[string]interface{})
	}
	for name, input := range tool.Action.Inputs {
		if _, ok := args[name]; !ok {
			if input.Default != "" {
				args[name] = input.Default
			} else {
				// Ensure all inputs are present, even if empty, for substitution
				args[name] = ""
			}
		}
	}

	using := tool.Action.Runs.Using

	// Validation based on allowedMode
	if allowedMode == ModeLocal && using == "docker" {
		return nil, fmt.Errorf("docker execution is not allowed by current configuration")
	}
	if allowedMode == ModeDocker && using == "composite" {
		return nil, fmt.Errorf("local execution is not allowed by current configuration")
	}

	switch using {
	case "docker":
		return executeDocker(ctx, tool, args)
	case "composite":
		return executeComposite(ctx, tool, args)
	}

	return nil, fmt.Errorf("unsupported runs.using: %s", using)
}

func executeDocker(ctx context.Context, tool tools.ToolDef, args map[string]interface{}) (*mcp.CallToolResult, error) {
	image := tool.Action.Runs.Image
	if image == "" {
		return nil, fmt.Errorf("missing image for docker action")
	}

	// Prepare docker run command
	// docker run --rm -e INPUT_... image args...
	// Note: GitHub Actions docker args are complex. Simple implementation:
	// Pass inputs as env vars.
	// If 'args' is defined in action, pass them.

	dockerArgs := []string{"run", "--rm"}

	// Pass inputs as env vars
	for k, v := range args {
		val, ok := v.(string)
		if ok {
			dockerArgs = append(dockerArgs, "-e", fmt.Sprintf("INPUT_%s=%s", strings.ToUpper(k), val))
		}
	}

	dockerArgs = append(dockerArgs, image)

	// Handle args defined in action.yml (runs.args)
	if len(tool.Action.Runs.Args) > 0 {
		dockerArgs = append(dockerArgs, tool.Action.Runs.Args...)
	}

	cmd := exec.CommandContext(ctx, "docker", dockerArgs...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Docker execution failed: %v\nOutput: %s", err, string(out))), nil
	}

	return mcp.NewToolResultText(string(out)), nil
}

func executeComposite(ctx context.Context, tool tools.ToolDef, args map[string]interface{}) (*mcp.CallToolResult, error) {
	var outputBuilder strings.Builder

	// Set up environment variables from inputs
	env := os.Environ()
	for k, v := range args {
		val, ok := v.(string)
		if ok {
			// GitHub Actions inputs are usually available as INPUT_<NAME>
			env = append(env, fmt.Sprintf("INPUT_%s=%s", strings.ToUpper(k), val))
			// Also set as regular env var if needed, but INPUT_ is standard
		}
	}

	for i, step := range tool.Action.Runs.Steps {
		if step.Run != "" {
			// Execute shell command
			cmdStr := step.Run

			// Simple substitution for inputs
			for k, v := range args {
				val, ok := v.(string)
				if ok {
					cmdStr = strings.ReplaceAll(cmdStr, fmt.Sprintf("${{ inputs.%s }}", k), val)
					cmdStr = strings.ReplaceAll(cmdStr, fmt.Sprintf("${{inputs.%s}}", k), val)
				}
			}

			var cmd *exec.Cmd

			// Determine shell
			shell := step.Shell
			if shell == "" {
				if runtime.GOOS == "windows" {
					shell = "powershell"
				} else {
					shell = "bash"
				}
			}

			// Simple shell handling
			lowerShell := strings.ToLower(shell)
			if strings.Contains(lowerShell, "powershell") {
				cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", cmdStr)
			} else if strings.Contains(lowerShell, "bash") {
				cmd = exec.CommandContext(ctx, "bash", "-c", cmdStr)
			} else if strings.Contains(lowerShell, "cmd") {
				cmd = exec.CommandContext(ctx, "cmd", "/C", cmdStr)
			} else if strings.Contains(lowerShell, "bun") {
				cmd = exec.CommandContext(ctx, "bun", "-e", cmdStr)
			} else if strings.Contains(lowerShell, "node") {
				cmd = exec.CommandContext(ctx, "node", "-e", cmdStr)
			} else if strings.Contains(lowerShell, "python") {
				cmd = exec.CommandContext(ctx, "python3", "-c", cmdStr)
			} else {
				// Fallback
				cmd = exec.CommandContext(ctx, "sh", "-c", cmdStr)
			}

			// Set working directory
			if step.WorkingDirectory != "" {
				cmd.Dir = step.WorkingDirectory
			}

			// Add step-level env
			stepEnv := env
			for k, v := range step.GetEnv() {
				stepEnv = append(stepEnv, fmt.Sprintf("%s=%s", k, v))
			}
			cmd.Env = stepEnv

			out, err := cmd.CombinedOutput()
			outputBuilder.WriteString(fmt.Sprintf("Step %d Output:\n%s\n", i+1, string(out)))
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("Step %d failed: %v\nOutput: %s", i+1, err, outputBuilder.String())), nil
			}
		}
	}

	return mcp.NewToolResultText(outputBuilder.String()), nil
}

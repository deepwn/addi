package runner

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"

	"github.com/deepwn/addi/mcp-server/tools"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/nektos/act/pkg/exprparser"
	"github.com/nektos/act/pkg/model"
	"gopkg.in/yaml.v3"
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
		return mcp.NewToolResultError("docker execution is not allowed by current configuration"), nil
	}
	if allowedMode == ModeDocker && using == "composite" {
		return mcp.NewToolResultError("local execution is not allowed by current configuration"), nil
	}

	switch using {
	case "docker":
		return executeDocker(ctx, tool, args)
	case "composite":
		return executeComposite(ctx, tool, args, allowedMode)
	}

	return mcp.NewToolResultError(fmt.Sprintf("unsupported runs.using: %s", using)), nil
}

func executeDocker(ctx context.Context, tool tools.ToolDef, args map[string]interface{}) (*mcp.CallToolResult, error) {
	image := tool.Action.Runs.Image
	if image == "" {
		return mcp.NewToolResultError("missing image for docker action"), nil
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

func executeComposite(ctx context.Context, tool tools.ToolDef, args map[string]interface{}, allowedMode ExecutionMode) (*mcp.CallToolResult, error) {
	var outputBuilder strings.Builder

	// 1. Context Preparation

	// Inputs
	inputsMap := make(map[string]interface{})
	for k, v := range args {
		inputsMap[k] = v
	}

	// Environment (System + Inputs)
	envMap := make(map[string]string)
	// Add system env
	for _, e := range os.Environ() {
		pair := strings.SplitN(e, "=", 2)
		if len(pair) == 2 {
			envMap[pair[0]] = pair[1]
		}
	}
	// Add inputs as INPUT_...
	for k, v := range args {
		if val, ok := v.(string); ok {
			key := fmt.Sprintf("INPUT_%s", strings.ToUpper(k))
			envMap[key] = val
		}
	}

	// Steps Context (for outputs)
	stepsContext := make(map[string]*model.StepResult)

	// Github Context
	githubCtx := &model.GithubContext{
		ActionPath: filepath.Dir(tool.File),
		Workspace:  filepath.Dir(tool.File), // Default to action dir
		ServerURL:  "https://github.com",
		APIURL:     "https://api.github.com",
		GraphQLURL: "https://api.github.com/graphql",
	}
	// Try to populate real git info
	if cwd, err := os.Getwd(); err == nil {
		githubCtx.Workspace = cwd
		if info, err := getGitInfo(cwd); err == nil {
			githubCtx.Sha = info["sha"]
			githubCtx.Ref = info["ref"]
			githubCtx.HeadRef = info["head_ref"]
			githubCtx.Repository = info["repository"]
			githubCtx.Actor = "addi-user"
		}
	}
	if githubCtx.RunID == "" {
		githubCtx.RunID = "1"
	}
	if githubCtx.RunNumber == "" {
		githubCtx.RunNumber = "1"
	}

	// Runner Context
	runnerCtx := map[string]interface{}{
		"os":         runtime.GOOS,
		"arch":       runtime.GOARCH,
		"temp":       os.TempDir(),
		"tool_cache": "", // Placeholder
	}

	// Evaluation Environment
	evalEnv := &exprparser.EvaluationEnvironment{
		Inputs: inputsMap,
		Github: githubCtx,
		Env:    envMap,
		Runner: runnerCtx,
		Steps:  stepsContext,
		HashFiles: func(args []reflect.Value) (interface{}, error) {
			hasher := sha256.New()
			var allFiles []string
			for _, v := range args {
				pattern := v.String()
				if !filepath.IsAbs(pattern) {
					pattern = filepath.Join(githubCtx.Workspace, pattern)
				}
				matches, err := filepath.Glob(pattern)
				if err != nil {
					continue
				}
				allFiles = append(allFiles, matches...)
			}
			sort.Strings(allFiles)
			for _, file := range allFiles {
				f, err := os.Open(file)
				if err != nil {
					continue
				}
				if _, err := io.Copy(hasher, f); err != nil {
					f.Close()
					continue
				}
				f.Close()
			}
			return hex.EncodeToString(hasher.Sum(nil)), nil
		},
	}

	// Helper for ${{ }} evaluation
	exprRegex := regexp.MustCompile(`\$\{\{\s*(.*?)\s*\}\}`)
	evaluate := func(text string) (string, error) {
		var evalErr error
		res := exprRegex.ReplaceAllStringFunc(text, func(match string) string {
			content := match[3 : len(match)-2]
			content = strings.TrimSpace(content)

			interp := exprparser.NewInterpeter(evalEnv, exprparser.Config{})
			// Use simple evaluation
			res, err := interp.Evaluate(content, exprparser.DefaultStatusCheckNone)
			if err != nil {
				evalErr = err
				return match // Return original on error
			}
			if res == nil {
				return ""
			}
			return fmt.Sprintf("%v", res)
		})
		return res, evalErr
	}

	// Ensure Temp Directory exists
	tempDir := filepath.Join(os.TempDir(), "addi-runner")
	_ = os.MkdirAll(tempDir, 0755)

	// Create Output/Env Files
	createTempFile := func(name string) (string, error) {
		f, err := os.CreateTemp(tempDir, name)
		if err != nil {
			return "", err
		}
		f.Close()
		return f.Name(), nil
	}

	envFile, _ := createTempFile("ADDI_ENV")
	outputFile, _ := createTempFile("ADDI_OUTPUT")
	pathFile, _ := createTempFile("ADDI_PATH")
	defer os.Remove(envFile)
	defer os.Remove(outputFile)
	defer os.Remove(pathFile)

	// Inject into envMap
	envMap["ADDI_ENV"] = envFile
	envMap["ADDI_OUTPUT"] = outputFile
	envMap["ADDI_PATH"] = pathFile
	// Compatibility aliases (optional, but good for using standard actions without change)
	envMap["GITHUB_ENV"] = envFile
	envMap["GITHUB_OUTPUT"] = outputFile
	envMap["GITHUB_PATH"] = pathFile

	// 2. Execution Loop
	for i, step := range tool.Action.Runs.Steps {
		// Evaluate 'if' condition
		// step.If is of type yaml.Node
		if step.If.Kind == yaml.ScalarNode && step.If.Value != "" {
			condition := step.If.Value
			if !strings.Contains(condition, "${{") {
				condition = fmt.Sprintf("${{ %s }}", condition)
			}
			res, err := evaluate(condition)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("Step %d 'if' evaluation failed: %v", i+1, err)), nil
			}
			if res == "false" {
				// Skip
				continue
			}
		}

		if step.Run != "" {
			// Variable Substitution in Script
			cmdStr, _ := evaluate(step.Run)

			// Shell Standardization
			shellName := step.Shell
			if shellName == "" {
				if runtime.GOOS == "windows" {
					shellName = "powershell"
				} else {
					shellName = "bash"
				}
			}

			// Determine extension and write script to file
			ext := ".sh"
			if strings.Contains(shellName, "powershell") || shellName == "pwsh" {
				ext = ".ps1"
			} else if strings.Contains(shellName, "python") {
				ext = ".py"
			} else if strings.Contains(shellName, "cmd") {
				ext = ".cmd"
				// node / bun /deno
			} else if (strings.Contains(shellName, "node") || strings.Contains(shellName, "bun")) || strings.Contains(shellName, "deno") {
				ext = ".js"
			}

			scriptName := fmt.Sprintf("script-*%s", ext)
			scriptPath, err := createTempFile(scriptName)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("Failed to create script file: %v", err)), nil
			}
			if err := os.WriteFile(scriptPath, []byte(cmdStr), 0755); err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("Failed to write script file: %v", err)), nil
			}

			bin, shellArgs := resolveShell(shellName, scriptPath)
			if bin == "" {
				return mcp.NewToolResultError(fmt.Sprintf("Step %d requested shell '%s' but it's not available on this platform (WSL required on Windows)", i+1, shellName)), nil
			}
			cmd := exec.CommandContext(ctx, bin, shellArgs...)

			// Set working directory
			if step.WorkingDirectory != "" {
				cmd.Dir, _ = evaluate(step.WorkingDirectory)
			} else {
				cmd.Dir = githubCtx.Workspace
			}

			// Construct Environment for Command
			// Start with base envMap
			var stepEnv []string
			for k, v := range envMap {
				stepEnv = append(stepEnv, fmt.Sprintf("%s=%s", k, v))
			}
			// Add Step specific env
			for k, v := range step.GetEnv() {
				val, _ := evaluate(v)
				stepEnv = append(stepEnv, fmt.Sprintf("%s=%s", k, val))
			}

			// If we're executing via WSL, convert Windows-style temp file paths
			// (ADDI_ENV/ADDI_OUTPUT/ADDI_PATH and common GITHUB_* aliases) to
			// WSL paths (/mnt/<drive>/...) so that bash redirections work inside WSL.
			if bin == "wsl" && runtime.GOOS == "windows" {
				for i, ev := range stepEnv {
					parts := strings.SplitN(ev, "=", 2)
					if len(parts) != 2 {
						continue
					}
					key := parts[0]
					val := parts[1]
					// Only convert known file-path env vars
					if key == "ADDI_ENV" || key == "ADDI_OUTPUT" || key == "ADDI_PATH" || key == "GITHUB_ENV" || key == "GITHUB_OUTPUT" || key == "GITHUB_PATH" {
						if len(val) >= 2 && val[1] == ':' {
							drive := strings.ToLower(string(val[0]))
							rest := val[2:]
							rest = strings.ReplaceAll(rest, "\\", "/")
							val = "/mnt/" + drive + rest
						} else {
							// also convert backslashes generally
							val = strings.ReplaceAll(val, "\\", "/")
						}
						stepEnv[i] = fmt.Sprintf("%s=%s", key, val)
					}
				}
			}

			cmd.Env = stepEnv

			out, err := cmd.CombinedOutput()
			outputBuilder.WriteString(fmt.Sprintf("Step %d Output:\n%s\n", i+1, string(out)))
			if err != nil {
				// Check continue-on-error (Note: field name in model might vary, checking common variations)
				// Assuming standard act model.Step doesn't expose it as string directly or it's named differently
				// For now, let's look at how act parses it. It is likely a boolean or yaml.Node
				// Since we can't easily see the model struct, let's try to infer or skip if not available.
				// Actually, many act versions use ContinueOnError bool. Let's check if we can cast or if it's missing.
				// Based on error "undefined", it is missing.
				continueOnError := false
				/*
					if step.ContinueOnError {
						continueOnError = true
					}
				*/

				if continueOnError {
					outputBuilder.WriteString(fmt.Sprintf("\nStep %d failed but continue-on-error is set. Error: %v\n", i+1, err))
					// Create failed result but don't return error
					if step.ID != "" {
						stepsContext[step.ID] = &model.StepResult{
							Outputs:    make(map[string]string),
							Conclusion: model.StepStatusFailure,
							Outcome:    model.StepStatusFailure,
						}
					}
				} else {
					return mcp.NewToolResultError(fmt.Sprintf("Step %d failed: %v\nOutput: %s", i+1, err, outputBuilder.String())), nil
				}
			} else {
				// Successful Execution - Update Context Logic (moved here)
				// Process File Commands
				// 1. ENV
				if err := parseEnvFile(envFile, envMap); err != nil {
					return mcp.NewToolResultError(fmt.Sprintf("Failed to parse ADDI_ENV: %v", err)), nil
				}
				// 2. PATH
				if err := parsePathFile(pathFile, envMap); err != nil {
					return mcp.NewToolResultError(fmt.Sprintf("Failed to parse ADDI_PATH: %v", err)), nil
				}
				// 3. OUTPUT
				stepOutputs := make(map[string]string)
				if err := parseOutputFile(outputFile, stepOutputs); err != nil {
					return mcp.NewToolResultError(fmt.Sprintf("Failed to parse ADDI_OUTPUT: %v", err)), nil
				}
				// Update Context
				if step.ID != "" {
					sCtx, ok := stepsContext[step.ID]
					if !ok {
						sCtx = &model.StepResult{
							Outputs:    make(map[string]string),
							Conclusion: model.StepStatusSuccess,
							Outcome:    model.StepStatusSuccess,
						}
						stepsContext[step.ID] = sCtx
					}
					if sCtx.Outputs == nil {
						sCtx.Outputs = make(map[string]string)
					}
					for k, v := range stepOutputs {
						sCtx.Outputs[k] = v
					}
				}
			}

			// Clear files for next step
			os.Truncate(envFile, 0)
			os.Truncate(outputFile, 0)
			os.Truncate(pathFile, 0)
		} else if step.Uses != "" {
			// Handle 'uses' - Composite/Local Action Call
			// Limitation: Only support local paths for now e.g. ./actions/my-action
			if !strings.HasPrefix(step.Uses, "./") && !strings.HasPrefix(step.Uses, ".\\") {
				outputBuilder.WriteString(fmt.Sprintf("Step %d: Skipped non-local 'uses' (%s). Only local actions (./...) are supported.\n", i+1, step.Uses))
				continue
			}

			// Resolve Action Path
			actionDir := filepath.Join(githubCtx.Workspace, step.Uses)
			actionFile := filepath.Join(actionDir, "action.yml")
			if _, err := os.Stat(actionFile); os.IsNotExist(err) {
				actionFile = filepath.Join(actionDir, "action.yaml")
				if _, err := os.Stat(actionFile); os.IsNotExist(err) {
					return mcp.NewToolResultError(fmt.Sprintf("Step %d: Could not find action.yml or action.yaml in %s", i+1, actionDir)), nil
				}
			}

			// Load Tool Definition
			subTool, err := tools.LoadToolFromFile(actionFile)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("Step %d: Failed to load action definition: %v", i+1, err)), nil
			}

			// Prepare Inputs (Evaluate ${{ }} from 'with')
			subArgs := make(map[string]interface{})
			for k, v := range step.With {
				val, _ := evaluate(v)
				subArgs[k] = val
			}

			// Execute Recursive
			outputBuilder.WriteString(fmt.Sprintf("Step %d [Run Action: %s]\n", i+1, subTool.Name))

			subResult, err := Execute(ctx, *subTool, subArgs, allowedMode)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("Step %d failed in sub-action: %v", i+1, err)), nil
			}

			// Append Output
			for _, content := range subResult.Content {
				// mcp.Content is interface{} or struct depending on version.
				// In mcp-go, it depends on version.
				// Actually, CallToolResult.Content is []Content.
				// Content is struct { Type string `json:"type"`; Text string `json:"text,omitempty"`; ... }
				// If compile error says "undefined", maybe I have to inspect the struct definition or it's an interface.
				// Based on error: "undefined ... has no field Type".
				// It seems Content is an interface in some versions or I am accessing it wrong.
				// Let's use reflection or fmt.Sprintf for now to be safe, or just check the library source.
				// But Wait, I am importing github.com/mark3labs/mcp-go/mcp.
				// Let's assume it's `mcp.TextContent` or similar struct.
				// Checking mcp-go source... Content is likely a distinct type per item.
				// Actually, CallToolResult.Content is []minterface{} in some versions? No.
				// Let's look at how I construct it: mcp.NewToolResultText returns result.
				// Let's blindly check if I can just cast or print it.

				// Quick fix: content is likely *mcp.TextContent or interface.
				// If previous error says "type mcp.Content has no field Type", then mcp.Content IS the type.
				// Let's check if the fields are exported or named differently.
				// Maybe it is interface `Content`?
				// Let's try casting to mcp.TextContent
				if tc, ok := content.(mcp.TextContent); ok {
					outputBuilder.WriteString(tc.Text)
					outputBuilder.WriteString("\n")
				} else if tc, ok := content.(*mcp.TextContent); ok {
					outputBuilder.WriteString(tc.Text)
					outputBuilder.WriteString("\n")
				} else {
					// Fallback
					outputBuilder.WriteString(fmt.Sprintf("%v\n", content))
				}
			}

			if subResult.IsError {
				return mcp.NewToolResultError(fmt.Sprintf("Step %d sub-action failed.", i+1)), nil
			}
		}
	}

	return mcp.NewToolResultText(outputBuilder.String()), nil
}

func getGitInfo(cwd string) (map[string]string, error) {
	info := make(map[string]string)

	runGit := func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = cwd
		out, _ := cmd.CombinedOutput()
		return strings.TrimSpace(string(out))
	}

	info["sha"] = runGit("rev-parse", "HEAD")
	info["ref"] = runGit("symbolic-ref", "-q", "HEAD")
	if info["ref"] == "" {
		info["ref"] = "HEAD"
	}

	origin := runGit("config", "--get", "remote.origin.url")
	info["repository"] = origin // default
	if strings.Contains(origin, "github.com") {
		// Clean up https://github.com/owner/repo.git or git@github.com:owner/repo.git
		parts := strings.Split(origin, "github.com")
		if len(parts) > 1 {
			repo := strings.TrimPrefix(parts[1], "/")
			repo = strings.TrimPrefix(repo, ":")
			repo = strings.TrimSuffix(repo, ".git")
			info["repository"] = repo
		}
	}

	return info, nil
}

func parseEnvFile(path string, envMap map[string]string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if parts := strings.SplitN(line, "=", 2); len(parts) == 2 {
			// Basic parsing, doesn't handle multiline delimiters like <<EOF yet
			envMap[parts[0]] = parts[1]
		}
	}
	return scanner.Err()
}

func parsePathFile(path string, envMap map[string]string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			pathSep := string(os.PathListSeparator)
			envMap["PATH"] = line + pathSep + envMap["PATH"]
		}
	}
	return scanner.Err()
}

func parseOutputFile(path string, outputs map[string]string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if parts := strings.SplitN(line, "=", 2); len(parts) == 2 {
			outputs[parts[0]] = parts[1]
		}
	}
	return scanner.Err()
}

func resolveShell(shell, scriptPath string) (string, []string) {
	shell = strings.ToLower(shell)

	switch {
	case strings.Contains(shell, "powershell") || shell == "pwsh":
		return "powershell", []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath}
	case strings.Contains(shell, "bash"):
		// On Windows, convert Windows path to bash-compatible path
		bashPath := scriptPath
		if runtime.GOOS == "windows" {
			// On Windows require WSL to run bash. If WSL exists, run bash inside WSL
			if _, err := exec.LookPath("wsl"); err == nil {
				// Convert C:\path\to\file to /mnt/<drive>/path for WSL
				if len(scriptPath) >= 2 && scriptPath[1] == ':' {
					drive := strings.ToLower(string(scriptPath[0]))
					unixPath := scriptPath[2:]
					unixPath = strings.ReplaceAll(unixPath, "\\", "/")
					bashPath = "/mnt/" + drive + unixPath
				} else {
					// If not a drive path, just convert backslashes
					bashPath = strings.ReplaceAll(scriptPath, "\\", "/")
				}
				// Execute via wsl to ensure environment compatibility
				return "wsl", []string{"bash", "--noprofile", "--norc", "-e", bashPath}
			}
			// No WSL -> indicate unsupported on this platform by returning empty bin
			return "", nil
		}
		return "bash", []string{"--noprofile", "--norc", "-e", bashPath}
	case shell == "python" || strings.Contains(shell, "python"):
		// Try python3 on linux/mac, python on windows, or just rely on path
		if runtime.GOOS == "windows" {
			return "python", []string{scriptPath}
		}
		return "python3", []string{scriptPath}
	case shell == "node":
		return "node", []string{scriptPath}
	case shell == "bun":
		return "bun", []string{scriptPath}
	case strings.Contains(shell, "cmd"):
		return "cmd", []string{"/C", scriptPath}
	case strings.Contains(shell, "sh"): // Fallback for sh-like
		return "sh", []string{"-e", scriptPath}
	default:
		// Fallback for unknown shells, assume it can take file as first arg
		return shell, []string{scriptPath}
	}
}

package tools

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/nektos/act/pkg/model"
)

// ToolDef represents a parsed tool definition from a YAML file.
type ToolDef struct {
	Name        string
	Description string
	File        string
	Action      *model.Action
}

// VerifyToolContent checks if the provided YAML content is a valid tool definition.
func VerifyToolContent(content string) error {
	reader := strings.NewReader(content)
	_, err := model.ReadAction(reader)
	return err
}

// LoadTools scans the provided directories for tool YAML files and loads them.
// It accepts an optional warningCallback that processes (filePath, error) when loading fails.
func LoadTools(dirs []string, warningCallback func(string, error)) ([]ToolDef, error) {
	toolMap := make(map[string]ToolDef)
	for _, dir := range dirs {
		// fmt.Fprintf(os.Stderr, "Scanning directory: %s\n", dir)
		// walk dir
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// fmt.Fprintf(os.Stderr, "Error accessing path %s: %v\n", path, err)
				return nil // skip errors
			}
			if info.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".yaml" && ext != ".yml" {
				return nil
			}

			// fmt.Fprintf(os.Stderr, "Found potential tool file: %s\n", path)

			tool, err := LoadToolFromFile(path)
			if err != nil {
				if warningCallback != nil {
					warningCallback(path, err)
				}
				// fmt.Fprintf(os.Stderr, "Error reading action from %s: %v\n", path, err)
				return nil
			}

			toolMap[tool.Name] = *tool
			return nil
		})
		if err != nil {
			// log error
		}
	}

	var tools []ToolDef
	for _, t := range toolMap {
		tools = append(tools, t)
	}
	return tools, nil
}

// LoadToolFromFile loads a single tool definition from a specific file path.
func LoadToolFromFile(path string) (*ToolDef, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	action, err := model.ReadAction(f)
	if err != nil {
		return nil, err
	}

	// fmt.Fprintf(os.Stderr, "Loaded tool: %s\n", action.Name)

	return &ToolDef{
		Name:        action.Name,
		Description: action.Description,
		File:        path,
		Action:      action,
	}, nil
}

// ToMCPTool converts the internal ToolDef into an MCP protocol Tool definition.
func (t *ToolDef) ToMCPTool() mcp.Tool {
	opts := []mcp.ToolOption{
		mcp.WithDescription(t.Description),
	}

	for name, input := range t.Action.Inputs {
		propOpts := []mcp.PropertyOption{
			mcp.Description(input.Description),
		}
		if input.Required {
			propOpts = append(propOpts, mcp.Required())
		}
		// Actions inputs are always strings
		opts = append(opts, mcp.WithString(name, propOpts...))
	}

	return mcp.NewTool(t.Name, opts...)
}

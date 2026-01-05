package tools

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/nektos/act/pkg/model"
)

type ToolDef struct {
	Name        string
	Description string
	File        string
	Action      *model.Action
}

func LoadTools(dirs []string) ([]ToolDef, error) {
	var tools []ToolDef
	for _, dir := range dirs {
		// walk dir
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // skip errors
			}
			if info.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".yaml" && ext != ".yml" {
				return nil
			}

			f, err := os.Open(path)
			if err != nil {
				return nil
			}
			defer f.Close()

			action, err := model.ReadAction(f)
			if err != nil {
				// Log error or skip
				return nil
			}

			tools = append(tools, ToolDef{
				Name:        action.Name,
				Description: action.Description,
				File:        path,
				Action:      action,
			})
			return nil
		})
		if err != nil {
			// log error
		}
	}
	return tools, nil
}

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

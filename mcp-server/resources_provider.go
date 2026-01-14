package main

import (
	"context"
	"fmt"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// registerResources scans a directory and registers all files as MCP resources.
func registerResources(s *server.MCPServer, rootDir string) error {
	absPath, err := filepath.Abs(rootDir)
	if err != nil {
		return fmt.Errorf("failed to resolve absolute path for resources: %w", err)
	}

	// Check if directory exists
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil // Gracefully skip if resources directory doesn't exist
	}

	fmt.Fprintf(os.Stderr, "Scanning resources in: %s\n", absPath)

	var count int
	err = filepath.WalkDir(absPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if d.IsDir() {
			return nil
		}

		// Calculate relative path for URI / name
		relPath, err := filepath.Rel(absPath, path)
		if err != nil {
			return nil
		}

		// Create a consistent URI (e.g., file:///editor.html)
		// For a real server, you might want a scheme like internal:// or just file://
		// Here we use the relative path as the key name/uri suffix
		slashPath := filepath.ToSlash(relPath)
		uri := fmt.Sprintf("file:///%s", slashPath)

		mimeType := mime.TypeByExtension(filepath.Ext(path))
		if mimeType == "" {
			mimeType = "text/plain"
		}

		resource := mcp.NewResource(
			uri,
			d.Name(),
			mcp.WithMIMEType(mimeType),
			mcp.WithResourceDescription(fmt.Sprintf("Static resource: %s", slashPath)),
		)

		// Register the resource with a handler that reads the file on demand
		s.AddResource(resource, func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil, fmt.Errorf("failed to read resource file: %w", err)
			}

			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      request.Params.URI,
					MIMEType: mimeType,
					Text:     string(content),
				},
			}, nil
		})

		count++
		return nil
	})

	if err != nil {
		return err
	}

	if count > 0 {
		fmt.Fprintf(os.Stderr, "Registered %d resources\n", count)
	}
	return nil
}

// registerEmbeddedResources scans an embedded FS and registers files as MCP resources.
// It uses internal:/// scheme to distinguish from local files.
func registerEmbeddedResources(s *server.MCPServer, fsys fs.FS) error {
	fmt.Fprintf(os.Stderr, "Scanning embedded resources...\n")

	var count int
	// Walk the embedded filesystem
	err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}

		// path in FS is forward slash separated, relative to root of FS
		// e.g. resources/templates/basic.yaml

		// Map it to a URI. We strip "resources/" prefix if present to make URI shorter?
		// Or just keep it. Let's keep it simple: internal:///<path>
		// Ensure path doesn't start with /
		cleanPath := strings.TrimPrefix(path, "/")
		uri := fmt.Sprintf("internal:///%s", cleanPath)

		mimeType := mime.TypeByExtension(filepath.Ext(path))
		if mimeType == "" {
			mimeType = "text/plain"
		}

		resource := mcp.NewResource(
			uri,
			d.Name(),
			mcp.WithMIMEType(mimeType),
			mcp.WithResourceDescription(fmt.Sprintf("Embedded resource: %s", cleanPath)),
		)

		s.AddResource(resource, func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			content, err := fs.ReadFile(fsys, path)
			if err != nil {
				return nil, fmt.Errorf("failed to read embedded resource: %w", err)
			}

			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      request.Params.URI,
					MIMEType: mimeType,
					Text:     string(content),
				},
			}, nil
		})

		count++
		return nil
	})

	if err != nil {
		return err
	}

	if count > 0 {
		fmt.Fprintf(os.Stderr, "Registered %d embedded resources\n", count)
	}
	return nil
}

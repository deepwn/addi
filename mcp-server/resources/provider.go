package resources

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Register scans a directory and registers all files as MCP resources.
// It accepts a URI builder function to allow flexibility in scheme generation (e.g., http vs file).
func Register(s *server.MCPServer, rootDir string, buildURI func(relPath string) string) error {
	absPath, err := filepath.Abs(rootDir)
	if err != nil {
		return fmt.Errorf("failed to resolve absolute path for resources: %w", err)
	}

	// Check if directory exists
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil // Gracefully skip if resources directory doesn't exist
	}

	log.Printf("Scanning resources in: %s", absPath)

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

		// Normalize separator to slash for URI usage
		slashPath := filepath.ToSlash(relPath)

		// Build URI using provided strategy or default to file:///
		var uri string
		if buildURI != nil {
			uri = buildURI(slashPath)
		} else {
			uri = fmt.Sprintf("file:///%s", slashPath)
		}

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

			// For HTTP-based clients, the "Text" field is useful.
			// If serving binary files, we should ideally use BlobResourceContents (mcp-go support pending or base64).
			// Mark3labs mcp-go supports TextResourceContents and BlobResourceContents

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
		log.Printf("Registered %d resources", count)
	}
	return nil
}

// RegisterEmbedded scans an embedded FS and registers files as MCP resources.
// It uses internal:/// scheme to distinguish from local files.
// fsys should be the root of the embedded filesystem you want to scan.
func RegisterEmbedded(s *server.MCPServer, fsys fs.FS) error {
	log.Printf("Scanning embedded resources...")

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
		log.Printf("Registered %d embedded resources", count)
	}
	return nil
}

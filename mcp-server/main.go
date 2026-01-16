package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/deepwn/addi/mcp-server/resources"
	"github.com/deepwn/addi/mcp-server/runner"
	"github.com/deepwn/addi/mcp-server/tools"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/spf13/cobra"
	"gopkg.in/natefinch/lumberjack.v2"
)

// Version is the current version of the application, set at build time.
var Version = "dev"

//go:embed resources/templates resources/reference/*.md
var templatesFS embed.FS

var (
	modeFlag     string
	dirsFlag     string
	watchFlag    bool
	portFlag     int
	hostFlag     string
	authFlag     string
	baseURLFlag  string
	corsFlag     string
	logLimitFlag int
)

func main() {
	rootCmd := &cobra.Command{
		Use:     "mcp-server",
		Short:   "Addi MCP Server",
		Version: Version,
		Run:     runServer,
	}

	flags := rootCmd.Flags()
	flags.StringVar(&modeFlag, "mode", "local", "Execution mode: local, docker, or both")
	flags.StringVar(&dirsFlag, "dirs", "", "Comma-separated list of directories to scan for tools")
	flags.BoolVar(&watchFlag, "watch", false, "Watch for file changes")
	flags.IntVar(&portFlag, "port", 0, "Port to listen on for HTTP (SSE). If 0, uses stdio")
	flags.StringVar(&hostFlag, "host", "127.0.0.1", "Host to listen on for HTTP (SSE)")
	flags.StringVar(&authFlag, "auth", "", "Authorization token for HTTP mode. If empty and port is set, generates a random token.")
	flags.StringVar(&baseURLFlag, "base-url", "", "Base URL for resources and SSE endpoints (e.g., https://api.example.com)")
	flags.StringVar(&corsFlag, "cors", "", "CORS Allowed Origin. If not set, CORS headers are not sent (access restricted).")
	flags.IntVar(&logLimitFlag, "log-limit", 15, "Number of days to keep logs")

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func setupLogger() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to get user home directory: %v\n", err)
		return
	}

	logDir := filepath.Join(homeDir, ".addi", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create log directory: %v\n", err)
		return
	}

	logFile := filepath.Join(logDir, "mcp-server.log")

	rotator := &lumberjack.Logger{
		Filename:   logFile,
		MaxSize:    10,           // megabytes (rotate after 10MB)
		MaxBackups: 0,            // keep all backups (until MaxAge)
		MaxAge:     logLimitFlag, // days to retain old log files
		Compress:   true,         // compress old logs
		LocalTime:  true,         // use local time for backup filenames
	}

	// multi-writer: stderr + file
	// SAFE for stdio transport because client only reads stdout
	mw := io.MultiWriter(os.Stderr, rotator)
	log.SetOutput(mw)
	log.SetFlags(log.LstdFlags | log.Lshortfile | log.Lmicroseconds)

	// Log startup time
	log.Printf("Starting Addi MCP Server %s", Version)
}

func runServer(cmd *cobra.Command, args []string) {
	setupLogger()

	execMode := runner.ExecutionMode(modeFlag)
	if execMode != runner.ModeLocal && execMode != runner.ModeDocker && execMode != runner.ModeBoth {
		log.Fatalf("Invalid mode: %s. Must be local, docker, or both", modeFlag)
	}

	// Create a new MCP server
	s := server.NewMCPServer(
		"addi-mcp-server",
		Version,
		server.WithResourceCapabilities(true, true),
		server.WithLogging(),
		server.WithToolCapabilities(true),
	)

	// Tool registry mapping
	var (
		fileToToolName = make(map[string]string)
		registryMutex  sync.RWMutex
	)

	registerTool := func(t tools.ToolDef) {
		registryMutex.Lock()
		fileToToolName[t.File] = t.Name
		registryMutex.Unlock()

		s.AddTool(t.ToMCPTool(), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			log.Printf("Executing tool: %s", t.Name)

			notification := mcp.NewLoggingMessageNotification(
				mcp.LoggingLevelInfo,
				"tool-execution",
				fmt.Sprintf("Executing tool: %s", t.Name),
			)
			paramsMap := make(map[string]interface{})
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

	// 1. Verify Tool
	verifyTool := mcp.NewTool("addi_tool_verify",
		mcp.WithDescription("Verify if a provided YAML string or file is a valid Addi/Action tool definition. Validates using 'act' action schema."),
		mcp.WithString("yaml_content", mcp.Description("The content of the YAML file to verify. Optional if file_path is provided.")),
		mcp.WithString("file_path", mcp.Description("The path to the YAML file to verify. Optional if yaml_content is provided.")),
	)
	s.AddTool(verifyTool, func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args, ok := request.Params.Arguments.(map[string]interface{})
		if !ok {
			return mcp.NewToolResultError("Invalid arguments"), nil
		}
		var err error
		if content, ok := args["yaml_content"].(string); ok && content != "" {
			err = tools.VerifyToolContent(content)
		} else if path, ok := args["file_path"].(string); ok && path != "" {
			_, err = tools.LoadToolFromFile(path)
		} else {
			return mcp.NewToolResultError("Either yaml_content or file_path must be provided"), nil
		}
		if err != nil {
			return mcp.NewToolResultText(fmt.Sprintf("Invalid tool definition: %v", err)), nil
		}
		return mcp.NewToolResultText("Valid tool definition"), nil
	})

	// 2. Info Tool (Server Info)
	s.AddTool(mcp.NewTool("addi_server_info",
		mcp.WithDescription("Get information about the Addi MCP server."),
	), func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		templateContent := ""
		if content, err := templatesFS.ReadFile("resources/templates/basic.yaml"); err == nil {
			templateContent = string(content)
		} else {
			templateContent = "# Template error: basic.yaml not found"
		}

		referenceDocs := []string{}
		if entries, err := templatesFS.ReadDir("resources/reference"); err == nil {
			for _, e := range entries {
				referenceDocs = append(referenceDocs, fmt.Sprintf("internal:///resources/reference/%s", e.Name()))
			}
		}

		// Reconstruct dirs list for display
		var d []string
		if dirsFlag != "" {
			d = strings.Split(dirsFlag, ",")
		} else {
			homeDir, _ := os.UserHomeDir()
			d = []string{filepath.Join(homeDir, ".addi"), ".addi/public", ".addi/private"}
		}

		info := struct {
			Version       string   `json:"version"`
			Mode          string   `json:"mode"`
			Directories   []string `json:"watched_directories"`
			LoadedCount   int      `json:"loaded_tools_count"`
			YamlTemplate  string   `json:"addi_tool_template"`
			ReferenceDocs []string `json:"reference_docs"`
		}{
			Version:       Version,
			Mode:          string(execMode),
			Directories:   d,
			LoadedCount:   len(fileToToolName), // Approximate as s.ListTools gives []Tool
			YamlTemplate:  templateContent,
			ReferenceDocs: referenceDocs,
		}
		jsonBytes, err := json.MarshalIndent(info, "", "  ")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Failed to marshal info: %v", err)), nil
		}
		return mcp.NewToolResultText(string(jsonBytes)), nil
	})

	// Load Tools
	var dirs []string
	if dirsFlag != "" {
		dirs = strings.Split(dirsFlag, ",")
	} else {
		homeDir, _ := os.UserHomeDir()
		dirs = []string{
			filepath.Join(homeDir, ".addi"),
			".addi/public",
			".addi/private",
		}
	}

	loadedTools, err := tools.LoadTools(dirs, func(path string, err error) {
		log.Printf("Warning: Failed to load tool from %s: %v", path, err)
		notification := mcp.NewLoggingMessageNotification(
			mcp.LoggingLevelWarning,
			"tool-loader",
			fmt.Sprintf("Failed to load tool from %s: %v", path, err),
		)
		paramsMap := map[string]interface{}{
			"level":  notification.Params.Level,
			"logger": notification.Params.Logger,
			"data":   notification.Params.Data,
		}
		s.SendNotificationToAllClients("notifications/message", paramsMap)
	})
	if err != nil {
		log.Printf("Error loading tools: %v", err)
	}
	for _, t := range loadedTools {
		registerTool(t)
	}

	// Register Resources
	// Map from URL path prefix to local directory for HTTP serving
	resourceMaps := make(map[string]string)

	for _, dir := range dirs {
		resDir := filepath.Join(dir, "resources")

		// URI Strategy:
		// If HTTP/SSE is enabled (port > 0), use http://<host>:<port>/resources/content/<relPath>?dir=<dirHash>??
		// Actually simpler: we can't easily map multiple dirs to one URL root space without conflicts or namespace.
		// Strategy:
		// 1. Stdio Mode: Use file:/// (Existing behavior)
		// 2. HTTP Mode: Use http://<host>:<port>/resources/<encoded_abs_path> ??
		// Or better: http://<host>:<port>/content/<safe_key>/<relpath>

		// Let's implement a "content" endpoint below and generate URIs pointing to it.
		// For now, we'll keep simplistic handling. If multiple dirs have same file, last one wins or we need namespaces.
		// Let's use a hashed ID for the directory or just base64 encode the full path in the URL to be safe?
		// A common pattern is http://host/resources/{resource_hash} but we want human readable if possible.

		err := resources.Register(s, resDir, func(relPath string) string {
			if portFlag > 0 {
				// HTTP Mode
				// We need to serve this file via HTTP.
				// We'll calculate a stable ID for this resource set (the rootDir) or just serve everything under valid roots.
				// Let's serve at: /content/<path_to_file>?root=<dir_index>
				// But we need to know WHICH dir `resDir` corresponds to.

				// Simplified: Just use file:/// for the 'URI' property in MCP resource list,
				// BUT the MCP client (if it's remote) cannot read file:///.
				// So the URI *must* be downloadable.

				// Let's use: http://<host>:<port>/files/<base64(abs_path)>
				// Or: http://<host>:<port>/files?path=<relPath>&root=<dir_hash>

				// We will register a handler for "/files" later.

				// We use a query parameter to pass the location securely?
				// No, that exposes FS. We only want to expose allowed directories.
				// We've already validated `dirs` list.

				// We will use a dedicated prefix for each directory relative to the `dirs` list.
				// Find index of `dir` in `dirs` to keep it short?
				// To keep it stateless, let's use the file name but this conflicts.

				// Let's use: http://.../resources/<hex_token>/<relPath>
				// Where hex_token is a hash of the root dir path.
				// We need to store this mapping.
				hash := sha256.Sum256([]byte(resDir))
				dirToken := hex.EncodeToString(hash[:])[:16]
				resourceMaps[dirToken] = resDir

				if baseURLFlag != "" {
					return fmt.Sprintf("%s/resources/%s/%s", strings.TrimRight(baseURLFlag, "/"), dirToken, relPath)
				}
				host := hostFlag
				if host == "0.0.0.0" {
					host = "127.0.0.1"
				} // Use localhost for generated URIs if 0.0.0.0
				return fmt.Sprintf("http://%s:%d/resources/%s/%s", host, portFlag, dirToken, relPath)
			}
			// Stdio Mode -> file:///
			return fmt.Sprintf("file:///%s", relPath)
		})

		if err != nil {
			log.Printf("Warning: Failed to register resources from %s: %v", resDir, err)
		}
	}
	if err := resources.RegisterEmbedded(s, templatesFS); err != nil {
		log.Printf("Warning: Failed to register embedded resources: %v", err)
	}

	// Start Watcher
	if watchFlag {
		w, err := tools.NewWatcher(dirs)
		if err != nil {
			log.Printf("Failed to start watcher: %v", err)
		} else {
			log.Println("Watcher started")
			w.Start(func(path string, action string) {
				if action == "remove" {
					registryMutex.Lock()
					if name, ok := fileToToolName[path]; ok {
						s.DeleteTools(name)
						delete(fileToToolName, path)
						log.Printf("Removed tool: %s", name)
					}
					registryMutex.Unlock()
				} else {
					t, err := tools.LoadToolFromFile(path)
					if err != nil {
						log.Printf("Error reloading tool %s: %v", path, err)
						return
					}
					registerTool(*t)
					log.Printf("Reloaded tool: %s", t.Name)
				}
				s.SendNotificationToAllClients(mcp.MethodNotificationToolsListChanged, nil)
			})
			defer w.Close()
		}
	}

	// START SERVER
	if portFlag > 0 {
		// Wait a bit to ensure watcher logs are flushed? Not needed.
		startHTTPServer(s, resourceMaps)
	} else {
		log.Println("Starting MCP server on Stdio")
		if err := server.ServeStdio(s); err != nil {
			log.Fatalf("Server error: %v", err)
		}
	}
}

func startHTTPServer(s *server.MCPServer, resourceMaps map[string]string) {
	token := authFlag
	if token == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("Failed to generate random token: %v", err)
		}
		token = hex.EncodeToString(b)
		// Print token to stdout so user/process can see it on startup
		fmt.Printf("MCP Server running on HTTP mode.\nAuthentication Token: %s\n", token)
		log.Printf("Generated Authentication Token: %s", token)
	}

	baseURL := baseURLFlag
	if baseURL == "" {
		host := hostFlag
		if host == "0.0.0.0" {
			host = "127.0.0.1"
		}
		baseURL = fmt.Sprintf("http://%s:%d", host, portFlag)
	}

	sseServer := server.NewSSEServer(s, server.WithBaseURL(baseURL))

	// CORS Origin Strategy
	if corsFlag == "*" {
		log.Println("Warning: CORS is set to allow all origins (*). This is insecure for production.")
	}

	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// CORS Handling to allow web clients (e.g. Playground)
			if corsFlag != "" {
				w.Header().Set("Access-Control-Allow-Origin", corsFlag)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			}

			// Allow passing token via query param for EventSource which doesn't support headers
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			// 1. Check Query Parameter (Common for EventSource / Image loading)
			if q := r.URL.Query().Get("token"); q == token {
				next.ServeHTTP(w, r)
				return
			}

			// 2. Check Authorization Header (Standard Bearer token)
			authHeader := r.Header.Get("Authorization")
			if authHeader != "" {
				// use Fields to handle multiple spaces/tabs
				parts := strings.Fields(authHeader)
				if len(parts) == 2 && parts[1] == token {
					next.ServeHTTP(w, r)
					return
				}
			}

			http.Error(w, "Unauthorized", http.StatusUnauthorized)
		})
	}

	mux := http.NewServeMux()
	mux.Handle("/sse", authMiddleware(sseServer.SSEHandler()))
	mux.Handle("/messages", authMiddleware(sseServer.MessageHandler()))

	// Serve Resources
	// URL: /resources/{dirToken}/{filePath...}
	resourceHandler := http.StripPrefix("/resources/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Path should be dirToken/relPath
		parts := strings.SplitN(r.URL.Path, "/", 2)
		if len(parts) < 2 {
			http.NotFound(w, r)
			return
		}
		dirToken := parts[0]
		relPath := parts[1]

		baseDir, ok := resourceMaps[dirToken]
		if !ok {
			http.NotFound(w, r)
			return
		}

		// Prevent path traversal
		// Clean and verify prefix
		targetPath := filepath.Join(baseDir, relPath)
		if !strings.HasPrefix(filepath.Clean(targetPath), filepath.Clean(baseDir)) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		http.ServeFile(w, r, targetPath)
	}))
	mux.Handle("/resources/", authMiddleware(resourceHandler))

	addr := fmt.Sprintf("%s:%d", hostFlag, portFlag)
	log.Printf("Listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("HTTP Server error: %v", err)
	}
}

# Addi MCP Server

This is a local Model Context Protocol (MCP) server for Addi. It allows you to define custom tools using YAML files (compatible with GitHub Actions syntax) and execute them locally (or via Docker).

## Features

- **Local Execution**: Runs tools directly on your host machine without Docker overhead (using `composite` actions).
- **Docker Execution**: Can run tools encapsulated in Docker containers.
- **GitHub Actions Syntax**: Supports `action.yml` format with `inputs`, `runs`, `steps`.
- **Automatic Discovery**: Automatically loads tools from configured directories.
- **Hot Reload**: Supports watching for file changes and re-registering tools on the fly.
- **Cross-Platform**: Works on Windows, macOS, and Linux.

## Installation & Build

1.  **Build from source**:
    ```bash
    go build -o mcp-server .
    ```

## CLI Usage

The server supports several flags and can run over Stdio (default) or HTTP (SSE).

```bash
./mcp-server [flags]
```

### Flags

- `--mode`: Execution mode.
  - `local`: Run tools directly on host (Default).
  - `docker`: Run tools in Docker containers.
  - `both`: Allow both execution modes.
- `--dirs`: Comma-separated list of directories to scan for tool definitions and resources.
  - Defaults to: `~/.addi`, `.addi/public`, `.addi/private`.
- `--watch`: Enable file watching. The server will auto-reload tools when YAML files are changed.
- `--port`: Port to listen on for HTTP (SSE). If `0` (default), uses Stdio mode.
- `--host`: Host to listen on for HTTP (SSE). Defaults to `127.0.0.1`.
- `--base-url`: Base URL for resources and SSE endpoints (e.g., `https://api.example.com`). Useful when running behind a proxy.
- `--cors`: Allowed CORS origin (e.g., `https://client.example.com`). If not set, CORS headers are not emitted.
- `--auth`: Authentication token for HTTP mode. If empty and running in HTTP mode, a random token is generated.
- `--log-limit`: Number of days to retain log files in `~/.addi/logs/`. Defaults to `15`.
- `--version`: Print version information.

## HTTP Mode (SSE)

You can run the MCP server in standalone HTTP mode, enabling it to be used by clients over the network or locally without direct process management.

```bash
./mcp-server --port 8080 --auth my-secret-token
```

If no `--auth` token is provided, a random secure token will be generated and printed to stdout/logs.

## Resources

The server automatically scans for a `resources/` subdirectory within any of the configured `--dirs`. Files found in these directories are exposed as MCP Resources.

- **URI Format**: `file:///<relative_path>` (e.g., `file:///docs/guide.md`)
- **MIME Type**: Automatically detected based on file extension.

Additionally, the server embeds built-in resources (like templates and reference documentation) which are exposed under the `internal:///` scheme.

## Configuration (MCP Client)

To use this with an MCP client (like VS Code or Claude Desktop), configure it in your settings:

```json
{
  "mcpServers": {
    "addi-local": {
      "command": "/path/to/addi/mcp-server/mcp-server",
      "args": ["--watch", "--mode", "local"]
    }
  }
}
```

## Creating Custom Tools

Tools are defined using YAML files placed in one of the scanned directories (e.g., `.addi/public/`). The syntax mimics GitHub Actions `action.yml`.

### Supported Shells (Composite Actions)

When using `using: "composite"`, you can specify the `shell` for each step. The following shells are supported:

- `bash` (Default on Linux/macOS)
- `powershell` (Default on Windows)
- `cmd`
- `bun` (Runs JavaScript via `bun -e`)
- `node` (Runs JavaScript via `node -e`)
- `python` (Runs Python via `python3 -c`)

### Example: Local Script (`hello.yaml`)

```yaml
name: "hello-local"
description: "Say hello from local MCP"
inputs:
  name:
    description: "Name to greet"
    required: true
    default: "World"
runs:
  using: "composite"
  steps:
    - name: Print Greeting
      run: echo "Hello ${{ inputs.name }} from Local MCP!"
      shell: bash
```

### Example: JavaScript via Bun (`netinfo.yaml`)

```yaml
name: "get-netinfo"
description: "Get network info using JS"
inputs: {}
runs:
  using: "composite"
  steps:
    - run: |
        const os = require('os');
        console.log(JSON.stringify(os.networkInterfaces(), null, 2));
      shell: bun
```

### Example: Docker Action

```yaml
name: "python-task"
description: "Run a python script in docker"
runs:
  using: "docker"
  image: "python:3.9-slim"
  args:
    - "-c"
    - "print('Hello from Docker')"
```

## Directory Structure

The server scans for `.yaml` or `.yml` files in the following locations by default:

1.  **Global**: `~/.addi/` (User home directory)
2.  **Workspace Public**: `.addi/public/` (In the current working directory)
3.  **Workspace Private**: `.addi/private/` (In the current working directory - recommended for gitignore)

You can override these by passing `--dirs /custom/path/1,/custom/path/2`.

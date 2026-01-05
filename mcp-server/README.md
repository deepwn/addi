# Addi MCP Server

This is a local Model Context Protocol (MCP) server for Addi. It allows you to define custom tools using YAML files (compatible with GitHub Actions syntax) and execute them locally.

## Features

- **Local Execution**: Runs tools directly on your host machine (no Docker required for `composite` actions).
- **GitHub Actions Syntax**: Supports `action.yml` format with `inputs` and `runs`.
- **Automatic Discovery**: Loads tools from:
  - `~/.addi/*.yaml`
  - `.addi/public/*.yaml` (in current directory)
  - `.addi/private/*.yaml` (in current directory)

## Usage

1.  **Build**:
    ```bash
    go build .
    ```

2.  **Run**:
    The server runs over Stdio. You can configure it in your MCP client (e.g., VS Code, Claude Desktop).

    ```json
    {
      "mcpServers": {
        "addi-local": {
          "command": "/path/to/addi/mcp-server/mcp-server",
          "args": []
        }
      }
    }
    ```

## Tool Definition Example

Create a file `hello.yaml` in `.addi/public/`:

```yaml
name: "hello-local"
description: "Say hello from local MCP"
inputs:
  name:
    description: "Name to greet"
    required: true
runs:
  using: "composite"
  steps:
    - run: echo "Hello ${{ inputs.name }} from Local MCP!"
      shell: bash
```

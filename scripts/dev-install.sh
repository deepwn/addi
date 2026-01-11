#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$PROJECT_ROOT/release"
BIN_DIR="$RELEASE_DIR/bin"
MCP_TARGET_DIR="$HOME/.addi/bin"
MCP_TARGET="$MCP_TARGET_DIR/mcp-server"

# Check for code command
if ! command -v code &> /dev/null; then
    echo "Warning: VS Code CLI 'code' is not in your PATH."
fi

# Detect OS and Arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

if [ "$ARCH" = "x86_64" ]; then
    ARCH="amd64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    ARCH="arm64"
fi

BINARY_NAME="mcp-server-${OS}-${ARCH}"
if [ "$OS" = "windows" ] || [ "$OS" = "mingw64_nt" ]; then
    BINARY_NAME="${BINARY_NAME}.exe"
fi

SOURCE_MCP="$BIN_DIR/$BINARY_NAME"

if [ ! -f "$SOURCE_MCP" ]; then
    echo "Error: MCP Server binary not found at $SOURCE_MCP"
    echo "Please run build script first."
    exit 1
fi

# 1. Stop MCP Server
echo "Stopping MCP Server..."
pkill -f "mcp-server" || true

# 2. Copy MCP Server
mkdir -p "$MCP_TARGET_DIR"
echo "Copying binary to $MCP_TARGET..."
cp "$SOURCE_MCP" "$MCP_TARGET"
chmod +x "$MCP_TARGET"

# 3. Install VSIX
# Find the latest VSIX
VSIX_FILE=$(ls -t "$RELEASE_DIR"/*.vsix | head -n 1)

if [ -z "$VSIX_FILE" ]; then
    echo "Error: No VSIX file found in $RELEASE_DIR"
    exit 1
fi

echo "Installing extension: $(basename "$VSIX_FILE")..."
code --install-extension "$VSIX_FILE" --force

# 4. Restart Prompt
echo ""
read -p "Installation complete. Reload VS Code window now? (Y/n) " -n 1 -r REPLY
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    echo "Reloading VS Code..."
    code -r "$PROJECT_ROOT"
fi

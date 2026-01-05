#!/bin/bash
set -e

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$PROJECT_ROOT/release"
BIN_DIR="$RELEASE_DIR/bin"

echo "Project Root: $PROJECT_ROOT"
echo "Release Dir: $RELEASE_DIR"
echo "Bin Dir: $BIN_DIR"

# Clean and create release directories
rm -rf "$RELEASE_DIR"
mkdir -p "$BIN_DIR"

# 1. Build MCP Server for multiple platforms
echo "Building MCP Server..."
cd "$PROJECT_ROOT/mcp-server"

# 定义目标平台 (OS/ARCH)
platforms=(
    "darwin/amd64"
    "darwin/arm64"
    "linux/amd64"
    "linux/arm64"
    "windows/amd64"
    "windows/arm64"
)

for platform in "${platforms[@]}"
do
    platform_split=(${platform//\// })
    GOOS=${platform_split[0]}
    GOARCH=${platform_split[1]}
    
    output_name="mcp-server-${GOOS}-${GOARCH}"
    if [ "$GOOS" = "windows" ]; then
        output_name+=".exe"
    fi

    echo "Building for $GOOS/$GOARCH..."

    # Disable CGO for static binaries and easier cross-compilation
    # The project appears to be pure Go (parsing YAML, executing subprocesses), so CGO is likely unnecessary.
    env CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH go build -ldflags="-s -w" -o "$BIN_DIR/$output_name" .
    
    if [ $? -ne 0 ]; then
        echo "Failed to build for $GOOS/$GOARCH"
        exit 1
    fi
done

echo "MCP Server built successfully for all platforms."

cd "$PROJECT_ROOT"

# 2. Run Extension Release
echo "Running Extension Release..."
# 这会运行 package.json 中的 release 脚本: bun run package && vsce package ...
# 注意：生成的 VSIX 不会包含 bin/ 目录下的二进制文件（由 .vscodeignore 控制），
# 这些二进制文件应作为 GitHub Release 的 assets 上传。
bun run release

# Move VSIX package to release directory
echo "Moving VSIX package to release directory..."
mv "$PROJECT_ROOT"/*.vsix "$RELEASE_DIR/"

echo "Build and Release process completed. All artifacts are in $RELEASE_DIR"

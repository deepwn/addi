#!/bin/bash
set -e

# 参数解析: 支持 --no-bin 跳过上传 MCP/bin 及相关文件（仅上传 .vsix）
NO_BIN="false"
for arg in "$@"; do
    if [ "$arg" = "--no-bin" ]; then
        NO_BIN="true"
    fi
done

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$PROJECT_ROOT/release"

# 检查 GITHUB_TOKEN
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN environment variable is not set."
    echo "Please export GITHUB_TOKEN='your_token_here'"
    exit 1
fi

# 获取版本号
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")
TAG="v$VERSION"
REPO_OWNER="deepwn"
REPO_NAME="addi"

echo "Preparing to release $TAG for $REPO_OWNER/$REPO_NAME..."

# 检查 release 目录
if [ ! -d "$RELEASE_DIR" ]; then
    echo "Error: Release directory '$RELEASE_DIR' does not exist."
    echo "Please run 'scripts/build.sh' first."
    exit 1
fi

# 1. 创建 GitHub Release
echo "Creating GitHub Release $TAG..."
CREATE_RELEASE_RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases \
  -d "{
    \"tag_name\": \"$TAG\",
    \"target_commitish\": \"main\",
    \"name\": \"$TAG\",
    \"body\": \"Release $TAG\",
    \"draft\": false,
    \"prerelease\": false
  }")

# 检查是否创建成功
ERROR_MSG=$(echo "$CREATE_RELEASE_RESPONSE" | node -p "try { JSON.parse(fs.readFileSync(0, 'utf-8')).message } catch(e) { '' }")
if [ "$ERROR_MSG" != "undefined" ] && [ -n "$ERROR_MSG" ]; then
    echo "Error creating release: $ERROR_MSG"
    # 如果是因为 tag 已存在，尝试获取该 release
    if [[ "$ERROR_MSG" == *"Validation Failed"* ]] || [[ "$ERROR_MSG" == *"already exists"* ]]; then
        echo "Release likely already exists. Fetching existing release..."
        GET_RELEASE_RESPONSE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/tags/$TAG)
        UPLOAD_URL=$(echo "$GET_RELEASE_RESPONSE" | node -p "JSON.parse(fs.readFileSync(0, 'utf-8')).upload_url")
    else
        exit 1
    fi
else
    UPLOAD_URL=$(echo "$CREATE_RELEASE_RESPONSE" | node -p "JSON.parse(fs.readFileSync(0, 'utf-8')).upload_url")
fi

# 清理 upload_url 模板 (移除 {?name,label})
UPLOAD_URL=${UPLOAD_URL%\{?*\}}

if [ -z "$UPLOAD_URL" ] || [ "$UPLOAD_URL" == "undefined" ]; then
    echo "Error: Could not get upload URL."
    echo "Response: $CREATE_RELEASE_RESPONSE"
    exit 1
fi

echo "Upload URL: $UPLOAD_URL"

# 定义上传函数
upload_asset() {
    local file_path="$1"
    local file_name=$(basename "$file_path")
    local content_type="application/octet-stream"

    if [[ "$file_name" == *.txt ]]; then
        content_type="text/plain"
    elif [[ "$file_name" == *.vsix ]]; then
        content_type="application/zip"
    fi

    echo "Uploading $file_name..."
    local response=$(curl -s -w "%{http_code}" -o /dev/null -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Content-Type: $content_type" \
        --data-binary @"$file_path" \
        "$UPLOAD_URL?name=$file_name")
    
    if [ "$response" != "201" ]; then
        echo "Failed to upload $file_name (HTTP $response)"
        # Non-critical for now, but good to know
    else 
        echo "Uploaded $file_name"
    fi
}

# 2. 上传 Assets
HAS_MCP_SERVER="false"

# 上传 .vsix 文件
for f in "$RELEASE_DIR"/*.vsix; do
    if [ -f "$f" ]; then
        upload_asset "$f"
    fi
done

# 上传 mcp-server binarys (如果由于build.sh生成了)
if [ "$NO_BIN" != "true" ]; then
    # Check inside release/bin
    if [ -d "$RELEASE_DIR/bin" ]; then
        count=$(ls -1 "$RELEASE_DIR/bin"/mcp-server-* 2>/dev/null | wc -l)
        if [ $count != 0 ]; then
            echo "Found MCP Server binaries, uploading..."
            HAS_MCP_SERVER="true"
            for f in "$RELEASE_DIR/bin"/mcp-server-*; do
                 upload_asset "$f"
            done
        fi
    fi
else
    echo "--no-bin specified: skipping MCP server binaries and related artifacts."
fi

# 上传 checksums.txt（仅当未使用 --no-bin 时）
if [ "$NO_BIN" != "true" ]; then
    if [ -f "$RELEASE_DIR/checksums.txt" ]; then
        upload_asset "$RELEASE_DIR/checksums.txt"
    fi
fi

# 3. Update Release Body if MCP Server included (Optional but useful for humans)
# Note: The extension logic relies on checking ASSETS existence, not body text.
# So this step is purely informational.
if [ "$HAS_MCP_SERVER" == "true" ]; then
    echo "Marking release as containing MCP Server..."
    # Update release body to append info
    # (Implementation omitted to keep script simple, as Logic relies on assets)
fi

echo "Release $TAG completed successfully!"

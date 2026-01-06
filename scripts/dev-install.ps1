# scripts/dev-install.ps1
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir
$ReleaseDir = Join-Path $ProjectRoot "release"
$BinDir = Join-Path $ReleaseDir "bin"
$McpTargetDir = Join-Path $env:USERPROFILE ".addi\bin"
$McpTarget = Join-Path $McpTargetDir "mcp-server.exe"

# Check dependencies
if (-not (Get-Command "code" -ErrorAction SilentlyContinue)) {
    Write-Warning "VS Code CLI 'code' is not in your PATH. Extension installation and reload might fail."
}

# 1. Stop MCP Server
Write-Host "Stopping MCP Server..." -ForegroundColor Cyan
Stop-Process -Name "mcp-server" -Force -ErrorAction SilentlyContinue

# 2. Copy MCP Server
# Check if windows build exists
$SourceMcp = Join-Path $BinDir "mcp-server-windows-amd64.exe"
if (-not (Test-Path $SourceMcp)) {
    # Fallback/Check for arm64 if on arm machine potentially, but for now strict check or list
    $SourceMcp = Join-Path $BinDir "mcp-server-windows-arm64.exe"
    if (-not (Test-Path $SourceMcp)) {
        Write-Error "MCP Server binary not found in $BinDir. Please run 'npm run build' or 'scripts/build.ps1' first."
    }
}

if (-not (Test-Path $McpTargetDir)) {
    New-Item -ItemType Directory -Path $McpTargetDir -Force | Out-Null
}

Write-Host "Copying MCP Server..." -ForegroundColor Cyan
Write-Host "  Source: $SourceMcp"
Write-Host "  Dest:   $McpTarget"
Copy-Item -Path $SourceMcp -Destination $McpTarget -Force

# 3. Install VSIX
Write-Host "Installing Extension..." -ForegroundColor Cyan
$VsixFile = Get-ChildItem -Path $ReleaseDir -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($null -eq $VsixFile) {
    Write-Error "No VSIX file found in $ReleaseDir. Please run build script first."
}

Write-Host "  VSIX: $($VsixFile.Name)"
try {
    # .cmd is needed for powershell to execute batch/cmd wrappers correctly sometimes
    cmd /c code --install-extension "$($VsixFile.FullName)" --force
} catch {
    Write-Error "Failed to install extension. Ensure 'code' command is available."
}

# 4. Restart Prompt
Write-Host ""
$response = Read-Host "Installation complete. Reload VS Code window now? (Y/n)"
if ($response -eq "" -or $response -match "^[Yy]$") {
    Write-Host "Reloading VS Code..." -ForegroundColor Green
    cmd /c code -r "$ProjectRoot"
}

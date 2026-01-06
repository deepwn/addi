# build.ps1
$ErrorActionPreference = "Stop"

# 获取脚本所在目录的绝对路径
$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir
$ReleaseDir = Join-Path $ProjectRoot "release"
$BinDir = Join-Path $ReleaseDir "bin"

Write-Host "Project Root: $ProjectRoot"
Write-Host "Release Dir: $ReleaseDir"
Write-Host "Bin Dir: $BinDir"

# Clean and create release directories
if (Test-Path $ReleaseDir) {
    Remove-Item -Recurse -Force $ReleaseDir
}
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

# Get version from package.json
$PackageJsonPath = Join-Path $ProjectRoot "package.json"
$PackageJson = Get-Content $PackageJsonPath | ConvertFrom-Json
$Version = $PackageJson.version
Write-Host "Building version: $Version"

# 1. Build MCP Server for multiple platforms
Write-Host "Building MCP Server..."
Push-Location (Join-Path $ProjectRoot "mcp-server")

$Platforms = @(
    @{ OS = "darwin"; Arch = "amd64" }
    @{ OS = "darwin"; Arch = "arm64" }
    @{ OS = "linux"; Arch = "amd64" }
    @{ OS = "linux"; Arch = "arm64" }
    @{ OS = "windows"; Arch = "amd64" }
    @{ OS = "windows"; Arch = "arm64" }
)

foreach ($Target in $Platforms) {
    $OS = $Target.OS
    $Arch = $Target.Arch
    
    $OutputName = "mcp-server-${OS}-${Arch}"
    if ($OS -eq "windows") {
        $OutputName += ".exe"
    }
    
    Write-Host "Building for $OS/$Arch..."
    
    $Env:CGO_ENABLED = "0"
    $Env:GOOS = $OS
    $Env:GOARCH = $Arch
    
    $OutputPath = Join-Path $BinDir $OutputName
    
    # Run go build (using cmd /c to ensure correct parsing of flags if needed, but direct usually works in PS Core/5.1)
    go build -ldflags="-s -w -X main.Version=$Version" -o $OutputPath .
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build for $OS/$Arch"
        Pop-Location
        exit 1
    }
}

# Cleanup Env vars
$Env:CGO_ENABLED = $null
$Env:GOOS = $null
$Env:GOARCH = $null

Pop-Location

Write-Host "MCP Server built successfully for all platforms."

# Generate Checksums
Write-Host "Generating checksums..."
$ChecksumFile = Join-Path $ReleaseDir "checksums.txt"
$Checksums = @()

function Get-Sha256Hash {
    param($FilePath)
    try {
        $FileStream = [System.IO.File]::OpenRead($FilePath)
        $Hasher = [System.Security.Cryptography.SHA256]::Create()
        $HashBytes = $Hasher.ComputeHash($FileStream)
        $FileStream.Close()
        # $FileStream.Dispose() # Close calls Dispose
        return [BitConverter]::ToString($HashBytes).Replace("-", "").ToLower()
    } catch {
        Write-Error "Failed to calculate hash for $FilePath : $_"
        return $null
    }
}

Get-ChildItem -Path $BinDir -File | ForEach-Object {
    $HashString = Get-Sha256Hash -FilePath $_.FullName
    if ($HashString) {
        # Format: hash  filename (matching standard sha256sum output with lowercase hash and 2 spaces)
        $Entry = "{0}  {1}" -f $HashString, $_.Name
        $Checksums += $Entry
    }
}

$Checksums | Out-File -FilePath $ChecksumFile -Encoding ASCII

# 2. Run Extension Release
Write-Host "Running Extension Release..."
Push-Location $ProjectRoot

# Execute bun run release
# Note: Ensure bun is in your PATH
bun run release

if ($LASTEXITCODE -ne 0) {
    Write-Error "Extension release failed"
    Pop-Location
    exit 1
}

# Move VSIX package to release directory
Write-Host "Moving VSIX package to release directory..."
Get-ChildItem -Path $ProjectRoot -Filter "*.vsix" | Move-Item -Destination $ReleaseDir -Force

Pop-Location

Write-Host "Build and Release process completed. All artifacts are in $ReleaseDir"

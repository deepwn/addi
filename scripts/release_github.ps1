# scripts/release_github.ps1
$ErrorActionPreference = 'Stop'

# 获取脚本所在目录的绝对路径
$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir
$ReleaseDir = Join-Path $ProjectRoot 'release'
$BinDir = Join-Path $ReleaseDir 'bin'

# 检查 GITHUB_TOKEN
if (-not $env:GITHUB_TOKEN) {
    Write-Error 'Error: GITHUB_TOKEN environment variable is not set.'
    Write-Host "Please set it: `$env:GITHUB_TOKEN='your_token_here'"
    exit 1
}

# 获取版本号
$PackageJsonPath = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path $PackageJsonPath)) {
    Write-Error "package.json not found at $PackageJsonPath"
    exit 1
}
$PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$Version = $PackageJson.version
$Tag = "v$Version"
$RepoOwner = 'deepwn'
$RepoName = 'addi'

Write-Host "Preparing to release $Tag for $RepoOwner/$RepoName..." -ForegroundColor Cyan

# 检查 release 目录
if (-not (Test-Path $ReleaseDir)) {
    Write-Error "Error: Release directory '$ReleaseDir' does not exist."
    Write-Host "Please run 'scripts/build.ps1' first."
    exit 1
}

$Headers = @{
    'Authorization' = "token $env:GITHUB_TOKEN"
    'Accept'        = 'application/vnd.github.v3+json'
}

# 1. 创建 GitHub Release
Write-Host "Creating GitHub Release $Tag..." -ForegroundColor Cyan

$ReleaseUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases"
$Body = @{
    tag_name         = $Tag
    target_commitish = 'main'
    name             = $Tag
    body             = "Release $Tag"
    draft            = $false
    prerelease       = $false
} | ConvertTo-Json

$UploadUrl = $null

try {
    $Response = Invoke-RestMethod -Uri $ReleaseUrl -Method Post -Headers $Headers -Body $Body -ContentType 'application/json'
    $UploadUrl = $Response.upload_url
}
catch {
    $ErrorMessage = $_.Exception.Message
    $ErrorResponse = $null
    
    # 尝试解析错误响应体
    try {
        if ($_.Exception.Response) {
            $Stream = $_.Exception.Response.GetResponseStream()
            $Reader = New-Object System.IO.StreamReader($Stream)
            $ErrorBody = $Reader.ReadToEnd()
            if ($ErrorBody) {
                $ErrorResponse = $ErrorBody | ConvertFrom-Json
            }
        }
    }
    catch {}

    Write-Warning "Attempt to create release failed: $ErrorMessage"
    
    # 检查是否因为 tag 已存在 (通常是 Validation Failed 且 code 为 already_exists，或者简单的 422)
    # GitHub API validation errors usually look like { "errors": [ { "code": "already_exists" } ] }
    $AlreadyExists = $false
    if ($ErrorResponse -and $ErrorResponse.errors) {
        foreach ($err in $ErrorResponse.errors) {
            if ($err.code -eq 'already_exists') {
                $AlreadyExists = $true
                break
            }
        }
    }

    if ($AlreadyExists) {
        Write-Host 'Release tag already exists. Fetching existing release...' -ForegroundColor Yellow
        try {
            $GetReleaseUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/$Tag"
            $ExistingRelease = Invoke-RestMethod -Uri $GetReleaseUrl -Method Get -Headers $Headers
            $UploadUrl = $ExistingRelease.upload_url
        }
        catch {
            Write-Error "Failed to fetch existing release: $($_.Exception.Message)"
            exit 1
        }
    }
    else {
        if ($ErrorResponse) {
            Write-Error "API Error: $($ErrorResponse | ConvertTo-Json -Depth 5)"
        }
        exit 1
    }
}

# 清理 upload_url 模板 (移除 {?name,label})
if ($UploadUrl -match '\{.*\}') {
    $UploadUrl = $UploadUrl -replace '\{.*\}', ''
}

if (-not $UploadUrl) {
    Write-Error 'Error: Could not get upload URL.'
    exit 1
}

Write-Host "Upload URL: $UploadUrl" -ForegroundColor Gray

# 定义上传函数
function Upload-Asset {
    param (
        [string]$FilePath
    )

    $FileName = Split-Path $FilePath -Leaf
    $ContentType = 'application/octet-stream'

    if ($FileName -like '*.txt') {
        $ContentType = 'text/plain'
    }
    elseif ($FileName -like '*.vsix') {
        $ContentType = 'application/zip'
    }

    Write-Host "Uploading $FileName..." -NoNewline
    
    try {
        # 注意: Invoke-RestMethod 上传二进制文件需要使用 -InFile，
        # URL 参数需要手动拼接 name
        $AssetUploadUrl = "$UploadUrl`?name=$FileName"
        
        # GitHub API 对 asset upload 的 content-type 有要求
        # PowerShell 7 (Core) 的 Invoke-RestMethod 更灵活，但为了兼容性，
        # 使用 WebClient 或者 System.Net.Http.HttpClient 可能更稳，但 Invoke-RestMethod -InFile 通常在 PS5.1+ 也行
        # headers 需要重新定义因为 Content-Type 变了
        $UploadHeaders = $Headers.Clone()
        $UploadHeaders['Content-Type'] = $ContentType

        $Response = Invoke-RestMethod -Uri $AssetUploadUrl -Method Post -Headers $UploadHeaders -InFile $FilePath -ContentType $ContentType
        Write-Host ' Done.' -ForegroundColor Green
    }
    catch {
        Write-Host ' Failed!' -ForegroundColor Red
        Write-Error "Failed to upload $FileName : $($_.Exception.Message)"
        # 不退出，继续尝试上传其他文件
    }
}

# 2. 上传 Assets

# 上传 .vsix 文件
Get-ChildItem -Path $ReleaseDir -Filter '*.vsix' | ForEach-Object {
    Upload-Asset -FilePath $_.FullName
}

# 上传 checksums.txt
$ChecksumsFile = Join-Path $ReleaseDir 'checksums.txt'
if (Test-Path $ChecksumsFile) {
    Upload-Asset -FilePath $ChecksumsFile
}

# 上传 binaries (在 bin 目录下)
if (Test-Path $BinDir) {
    Get-ChildItem -Path $BinDir | ForEach-Object {
        if (-not $_.PSIsContainer) {
            Upload-Asset -FilePath $_.FullName
        }
    }
}

Write-Host 'Release completed successfully!' -ForegroundColor Green

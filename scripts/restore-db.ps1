param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [switch]$RestoreEnv
)

$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $PSScriptRoot
$dbPath = Join-Path $appDir "data/polaris.sqlite"

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Backup file not found: $Source"
}

New-Item -ItemType Directory -Force -Path (Join-Path $appDir "data"), (Join-Path $appDir "public/uploads") | Out-Null

if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 stop polaris | Out-Null
}

function Restore-DatabaseFile {
  param([string]$DatabaseFile)
  Copy-Item -LiteralPath $DatabaseFile -Destination $dbPath -Force
  Remove-Item -LiteralPath "$dbPath-wal", "$dbPath-shm" -Force -ErrorAction SilentlyContinue
}

$extension = [System.IO.Path]::GetExtension($Source).ToLowerInvariant()
$isTarGz = $Source.ToLowerInvariant().EndsWith(".tar.gz") -or $Source.ToLowerInvariant().EndsWith(".tgz")

if ($extension -in @(".sqlite", ".db")) {
  Restore-DatabaseFile -DatabaseFile $Source
} elseif ($isTarGz) {
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("polaris-restore-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  try {
    tar -xzf $Source -C $tempDir
    $database = Get-ChildItem -LiteralPath $tempDir -Recurse -File |
      Where-Object { $_.Name -eq "polaris.sqlite" -or $_.Extension -in @(".sqlite", ".db") } |
      Select-Object -First 1
    if (-not $database) {
      throw "No SQLite database file found inside archive."
    }

    Restore-DatabaseFile -DatabaseFile $database.FullName

    $uploads = Get-ChildItem -LiteralPath $tempDir -Recurse -Directory |
      Where-Object { $_.FullName -replace '\\', '/' -match '/public/uploads$' } |
      Select-Object -First 1
    if ($uploads) {
      Copy-Item -LiteralPath (Join-Path $uploads.FullName "*") -Destination (Join-Path $appDir "public/uploads") -Recurse -Force -ErrorAction SilentlyContinue
    }

    $envFile = Join-Path $tempDir ".env"
    if ($RestoreEnv -and (Test-Path -LiteralPath $envFile)) {
      Copy-Item -LiteralPath $envFile -Destination (Join-Path $appDir ".env") -Force
    }
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
} else {
  throw "Unsupported restore source. Use .tar.gz, .tgz, .sqlite, or .db."
}

Write-Host "Restore complete: $dbPath"
Write-Host "Restart Polaris-by-mahaz before opening the app."

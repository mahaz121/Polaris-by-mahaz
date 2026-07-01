$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $PSScriptRoot
Set-Location $appDir

Write-Host "Installing Polaris-by-mahaz production app..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 18 or newer is required. Install Node.js, then rerun this script."
}

New-Item -ItemType Directory -Force -Path "data/sessions", "data/backups", "public/uploads" | Out-Null

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example."
}

$envContent = Get-Content ".env" -Raw
if ($envContent -match "(?m)^PORT=") {
  $envContent = $envContent -replace "(?m)^PORT=.*$", "PORT=3004"
} else {
  $envContent = $envContent.TrimEnd() + "`r`nPORT=3004`r`n"
}

if ($envContent -match "(?m)^SESSION_SECRET=(replace-with-a-generated-strong-secret|change-this.*|)$") {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  $envContent = $envContent -replace "(?m)^SESSION_SECRET=.*$", "SESSION_SECRET=$secret"
  Write-Host "Generated a strong SESSION_SECRET in .env."
}

Set-Content ".env" $envContent

npm ci --omit=dev
npm run migrate

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  npm install -g pm2
}

pm2 start ecosystem.config.cjs --env production
pm2 save

Write-Host "Polaris-by-mahaz is running on http://localhost:3004"

# Hermes Phase D self-hosted GitHub Actions runner — one-time bootstrap
# Run this ONCE from an elevated PowerShell terminal (Win+X → Terminal (Admin)).
# After setup, the runner starts automatically at login and CI jobs
# execute on YOUR machine with zero GitHub Actions billing.
#
# Example: powershell -File bootstrap-windows-runner.ps1 -Token "YOUR_TOKEN"

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,
    [string]$Repo = "Bigfootage/hermes-desktop-client",
    [string]$RunnerDir = "$env:LOCALAPPDATA\actions-runner"
)

$ErrorActionPreference = "Stop"
Write-Host "=== Hermes Phase D GitHub Actions Runner Bootstrap ===" -ForegroundColor Cyan

$Url = "https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-win-x64-2.337.0.zip"
$Zip = "$env:TEMP\actions-runner.zip"
Write-Host "Downloading runner v2.337.0 ..."
Invoke-WebRequest -Uri $Url -OutFile $Zip

if (Test-Path $RunnerDir) { Remove-Item -Recurse -Force $RunnerDir }
New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null
Expand-Archive -Path $Zip -DestinationPath $RunnerDir -Force
Remove-Item $Zip

Push-Location $RunnerDir
Write-Host "Registering runner with GitHub ..."
.\config.cmd `
  --url "https://github.com/$Repo" `
  --token $Token `
  --name "lucas-windows" `
  --labels "self-hosted,Windows,X64,hermes-phase-d" `
  --unattended `
  --replace

Write-Host "Installing as Windows service (auto-start at boot) ..."
.\svc.cmd install
.\svc.cmd start

Write-Host "=== Runner is LIVE ===" -ForegroundColor Green
Write-Host "CI builds will now run on this machine at zero cost."
Write-Host "To uninstall: Stop-Service actions.runner.* ; .\svc.cmd uninstall" -ForegroundColor Yellow
Pop-Location
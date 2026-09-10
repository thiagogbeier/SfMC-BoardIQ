<#
  Start-Boards.ps1 — launches the board app for this folder.
  Port and branding come from instance.json unless overridden.
  Usage: .\Start-Boards.ps1 [-Port 8790]
#>
param([int]$Port = 0)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }

$name = 'Client Boards'
$instFile = Join-Path $root 'instance.json'
if (Test-Path $instFile) {
  try {
    $j = Get-Content $instFile -Raw | ConvertFrom-Json
    if ($j.name) { $name = $j.name }
    if ((-not $Port -or $Port -le 0) -and $j.port) { $Port = [int]$j.port }
  } catch { }
}
if (-not $Port -or $Port -le 0) { $Port = 8790 }

$py = (Get-Command python -ErrorAction SilentlyContinue) ?? (Get-Command py -ErrorAction SilentlyContinue)
if (-not $py) { throw "Python 3 is required but was not found on PATH." }

Write-Host "Starting $name on http://127.0.0.1:$Port/ ..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
& $py.Source (Join-Path $root 'server.py') --port $Port

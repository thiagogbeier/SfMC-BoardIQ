<#
  Update-FromSfMC.ps1 — pulls feature updates from the production board.

  Copies CODE only (server.py, app/, PowerShell scripts). It never touches:
    data\          the demo dataset
    instance.json  branding, port, pinned clients
    docs\          demo screenshots
    seed_demo.py   the demo seeder

  That separation is the whole point: both instances run byte-identical code
  and differ only in configuration and data, so a feature built once in
  "SfMC Boards" lands here without a merge.

  Usage:
    .\Update-FromSfMC.ps1              # show what would change, then apply
    .\Update-FromSfMC.ps1 -WhatIf      # show only, change nothing
    .\Update-FromSfMC.ps1 -Source "D:\other\SfMC Boards"
#>
[CmdletBinding()]
param(
  [string] $Source,
  [switch] $WhatIf,
  [switch] $NoRestart
)

$ErrorActionPreference = 'Stop'
$dst = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }

if (-not $Source) { $Source = Join-Path (Split-Path $dst -Parent) 'SfMC Boards' }
if (-not (Test-Path $Source)) { throw "Source board not found: $Source" }

# Code files that are shared verbatim between instances.
$files = @(
  'server.py',
  'Watchdog.ps1',
  'Install-Autostart.ps1',
  'Start-Boards.ps1',
  'Sync-AzureDevOps.ps1',
  'app\index.html',
  'app\app.js',
  'app\styles.css'
)

function Get-Hash($path) {
  if (-not (Test-Path $path)) { return $null }
  (Get-FileHash -Path $path -Algorithm SHA256).Hash
}

Write-Host "Source : $Source"      -ForegroundColor Cyan
Write-Host "Target : $dst"          -ForegroundColor Cyan
Write-Host ""

$changed = @()
foreach ($f in $files) {
  $s = Join-Path $Source $f
  $d = Join-Path $dst $f
  if (-not (Test-Path $s)) {
    Write-Host ("  {0,-24} MISSING at source - skipped" -f $f) -ForegroundColor Yellow
    continue
  }
  $hs = Get-Hash $s
  $hd = Get-Hash $d
  if ($hs -eq $hd) {
    Write-Host ("  {0,-24} up to date" -f $f) -ForegroundColor DarkGray
  } else {
    $state = if ($hd) { 'differs' } else { 'new' }
    Write-Host ("  {0,-24} {1}" -f $f, $state) -ForegroundColor Green
    $changed += [pscustomobject]@{ Rel = $f; Src = $s; Dst = $d }
  }
}

Write-Host ""
if (-not $changed) {
  Write-Host "Already in sync - nothing to do." -ForegroundColor Green
  return
}

if ($WhatIf) {
  Write-Host "$($changed.Count) file(s) would be updated. Re-run without -WhatIf to apply." -ForegroundColor Yellow
  return
}

# Back up whatever we are about to overwrite, so a bad pull is reversible.
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $dst "data\code-backups\$stamp"
foreach ($c in $changed) {
  if (Test-Path $c.Dst) {
    $target = Join-Path $backup $c.Rel
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item $c.Dst $target -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $c.Dst) | Out-Null
  Copy-Item $c.Src $c.Dst -Force
}

Write-Host "Updated $($changed.Count) file(s)." -ForegroundColor Green
if (Test-Path $backup) { Write-Host "Previous copies: $backup" -ForegroundColor DarkGray }

# Keep only the last 10 code backups.
$root = Join-Path $dst 'data\code-backups'
if (Test-Path $root) {
  Get-ChildItem $root -Directory | Sort-Object Name -Descending |
    Select-Object -Skip 10 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

if ($NoRestart) { return }

$wd = Join-Path $dst 'Watchdog.ps1'
if (Test-Path $wd) {
  Write-Host "Restarting the demo server..." -ForegroundColor Cyan
  & $wd -Restart
}

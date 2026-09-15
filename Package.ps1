<#
  Package.ps1 — build the shareable SfMC-BoardIQ-<version>.zip.

  Pipeline:
      staging folder  ──Export-Repo──►  repo folder  ──stage+zip──►  .zip

  The zip is built from the REPOSITORY copy, never from this working folder.
  That matters: the repo copy has already been through the export safety scan
  and excludes .export-blocklist, data\backups, code-backups and logs. Zipping
  the working folder directly would ship all of them.

  Usage:
    .\Package.ps1                      # sync, then package
    .\Package.ps1 -SkipExport          # package whatever is in the repo now
    .\Package.ps1 -OutDir "C:\Share"   # write the .zip somewhere else
    .\Package.ps1 -Version 1.1         # override the version label
#>
[CmdletBinding()]
param(
  [string] $Source  = 'C:\GitHub\SfMC-BoardIQ',
  [string] $OutDir,
  [string] $Version,
  [switch] $SkipExport
)

$ErrorActionPreference = 'Stop'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $OutDir) { $OutDir = Split-Path $here -Parent }
if (-not $Version) { $Version = Get-Date -Format 'yyyy.MM.dd' }

function Step($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }
function Ok($t)       { Write-Host "    $t" -ForegroundColor Green }
function Info($t)     { Write-Host "    $t" -ForegroundColor DarkGray }
function Warn($t)     { Write-Host "    $t" -ForegroundColor Yellow }

Write-Host "Package SfMC:BoardIQ" -ForegroundColor White
Write-Host "  repo    : $Source"
Write-Host "  version : $Version"
Write-Host "  output  : $OutDir"

# ---------------------------------------------------------------- 1. sync
Step 1 'Refresh the repository copy'
if ($SkipExport) {
  Info 'skipped (-SkipExport)'
} else {
  $export = Join-Path $here 'Export-Repo.ps1'
  if (-not (Test-Path $export)) { throw "Export-Repo.ps1 not found beside this script." }
  & $export -Target $Source
  if ($LASTEXITCODE -eq 2) { throw "Export blocked by the safety scan - not packaging." }
  if ($LASTEXITCODE -ne 0) { throw "Export failed with exit code $LASTEXITCODE." }
  Ok 'repository refreshed and safety-scanned'
}

if (-not (Test-Path $Source)) { throw "Repository folder not found: $Source" }

# ------------------------------------------------------- 2. stage a clean tree
Step 2 'Stage a clean tree'
$stage = Join-Path ([IO.Path]::GetTempPath()) ("boardiq-pkg-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$root  = Join-Path $stage 'SfMC-BoardIQ'
New-Item -ItemType Directory -Force -Path $root | Out-Null

# /MIR into an empty folder, dropping anything a recipient must not receive.
# The three maintainer scripts (Export-Repo, Update-FromSfMC, Package) publish new
# versions of this package and expect folders a recipient will not have, so they
# stay in the repository but are kept out of the team handout.
robocopy $Source $root /MIR `
  /XD '.git' 'backups' 'code-backups' '__pycache__' `
  /XF '*.log' '*.tmp' 'proposals.json' '.export-blocklist' '.gitignore' `
       'Export-Repo.ps1' 'Update-FromSfMC.ps1' 'Package.ps1' `
  /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# data\backups is excluded above, but the app expects the folder to exist.
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data\backups') | Out-Null
Set-Content -Path (Join-Path $root 'data\backups\.keep') -Value '' -Encoding ascii

$staged = Get-ChildItem $root -Recurse -File -Force
Ok ("{0} files, {1:N1} MB" -f $staged.Count, (($staged | Measure-Object Length -Sum).Sum / 1MB))

# ---------------------------------------------------- 3. sanity-check the tree
Step 3 'Verify the package contents'

$required = @(
  'Start.cmd', 'server.py', 'instance.json', 'README.md',
  'Start-Boards.ps1', 'Watchdog.ps1', 'Install-Autostart.ps1', 'seed_demo.py',
  'app\index.html', 'app\app.js', 'app\styles.css',
  'data\store.json',
  'docs\INSTALL.html', 'docs\SfMC-BoardIQ-overview.html',
  'exports\README.md'
)
$missing = @()
foreach ($r in $required) { if (-not (Test-Path (Join-Path $root $r))) { $missing += $r } }
if ($missing) {
  Remove-Item $stage -Recurse -Force -EA SilentlyContinue
  throw "Package is missing required file(s):`n  " + ($missing -join "`n  ")
}
Ok "all $($required.Count) required files present"

  $forbidden = Get-ChildItem $root -Recurse -Force |
  Where-Object {
    $_.Name -in '.export-blocklist','proposals.json','Export-Repo.ps1','Update-FromSfMC.ps1','Package.ps1' -or
    $_.Extension -in '.log','.tmp' -or $_.Name -eq '.git'
  }
if ($forbidden) {
  Remove-Item $stage -Recurse -Force -EA SilentlyContinue
  throw "Package contains files that must not ship:`n  " + (($forbidden | ForEach-Object Name) -join "`n  ")
}
Ok 'no blocked files present'

# store.json must be the fictitious demo set, not someone's real board
$store = Get-Content (Join-Path $root 'data\store.json') -Raw | ConvertFrom-Json
$expected = 'NORTHWIND TRADERS','CONTOSO FINANCIAL GROUP','FABRIKAM HEALTH SYSTEMS'
$names = $store.clients.name
$unexpected = $names | Where-Object { $_ -notin ($expected + @('My Team','Manager 1:1','MyLearning')) }
if ($unexpected) {
  Remove-Item $stage -Recurse -Force -EA SilentlyContinue
  throw "data\store.json contains unexpected clients - refusing to package:`n  " + ($unexpected -join "`n  ")
}
Ok "demo data confirmed: $($store.clients.Count) fictitious clients, $($store.items.Count) items"

# ---------------------------------------------------------------- 4. zip
Step 4 'Build the archive'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zip = Join-Path $OutDir "SfMC-BoardIQ-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
  $stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

Remove-Item $stage -Recurse -Force -EA SilentlyContinue

$mb = (Get-Item $zip).Length / 1MB
Ok ("{0}  ({1:N1} MB)" -f (Split-Path $zip -Leaf), $mb)

# ---------------------------------------------------------------- 5. verify
Step 5 'Verify the archive opens and is complete'
Add-Type -AssemblyName System.IO.Compression
$za = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entries = $za.Entries | ForEach-Object { $_.FullName }
  # @() matters: with a single unique value Select-Object returns a scalar string,
  # and indexing a string gives you its first CHARACTER, not the whole name.
  $top = @($entries | ForEach-Object { ($_ -split '/')[0] } | Select-Object -Unique)
  if ($top.Count -ne 1 -or $top[0] -ne 'SfMC-BoardIQ') {
    throw "Archive should contain exactly one top-level folder 'SfMC-BoardIQ' but found: $($top -join ', ')"
  }
  foreach ($r in $required) {
    $e = 'SfMC-BoardIQ/' + ($r -replace '\\','/')
    if ($entries -notcontains $e) { throw "Archive is missing $e" }
  }
  Ok "$($entries.Count) entries, single root folder, all required files present"
} finally { $za.Dispose() }

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  $zip"
Write-Host "  Share this file. Recipients extract it and double-click Start.cmd." -ForegroundColor DarkGray
exit 0

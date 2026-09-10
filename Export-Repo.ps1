<#
  Export-Repo.ps1 — one command to refresh the public demo repository.

  Runs the whole pipeline:

      upstream board  ──code──►  this working copy  ──mirror──►  repo folder
      (real data)                (demo data)                     (publishable)

  Steps:
    1. Pull shared code from the upstream board (server.py, app\, *.ps1)
    2. Regenerate the fictitious demo dataset  (dates land relative to today)
    3. Rebuild the overview deck from current screenshots
    4. SAFETY SCAN - refuse to publish if anything from the real board leaked
    5. Mirror to the repo folder, excluding backups, logs and __pycache__

  The safety scan builds its blocklist FROM the upstream store.json - real client
  names, their search aliases, and the people named on their items. It therefore
  stays correct as clients are added, with no list to maintain here.

  Usage:
    .\Export-Repo.ps1                     # full run
    .\Export-Repo.ps1 -WhatIf             # report only, change nothing
    .\Export-Repo.ps1 -NoReseed           # keep the current demo data as-is
    .\Export-Repo.ps1 -NoDeck             # skip the (slow) deck rebuild
    .\Export-Repo.ps1 -Target "D:\repo"   # somewhere else
#>
[CmdletBinding()]
param(
  [string] $Upstream,
  [string] $Target = 'C:\GitHub\SfMC-BoardIQ',
  [switch] $NoReseed,
  [switch] $NoDeck,
  [switch] $WhatIf,
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Upstream) { $Upstream = Join-Path (Split-Path $here -Parent) 'SfMC Boards' }

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Ok($text)       { Write-Host "    $text" -ForegroundColor Green }
function Info($text)     { Write-Host "    $text" -ForegroundColor DarkGray }
function Warn($text)     { Write-Host "    $text" -ForegroundColor Yellow }

Write-Host "Export SfMC:BoardIQ" -ForegroundColor White
Write-Host "  upstream : $Upstream"
Write-Host "  staging  : $here"
Write-Host "  target   : $Target"
if ($WhatIf) { Write-Host "  MODE     : -WhatIf, nothing will be written" -ForegroundColor Yellow }

# --------------------------------------------------------------- 1. pull code
Step 1 'Pull shared code from the upstream board'

$shared = @(
  'server.py', 'Watchdog.ps1', 'Install-Autostart.ps1', 'Start-Boards.ps1',
  'Sync-AzureDevOps.ps1', 'app\index.html', 'app\app.js', 'app\styles.css'
)

if (-not (Test-Path $Upstream)) {
  Warn "Upstream board not found - skipping the code pull."
  Warn "Pass -Upstream '<path>' if it lives elsewhere. Export continues with the code already here."
} else {
  $pulled = 0
  foreach ($f in $shared) {
    $s = Join-Path $Upstream $f
    $d = Join-Path $here $f
    if (-not (Test-Path $s)) { Warn "missing upstream: $f"; continue }
    $hs = (Get-FileHash $s).Hash
    $hd = if (Test-Path $d) { (Get-FileHash $d).Hash } else { $null }
    if ($hs -eq $hd) { continue }
    if ($WhatIf) { Info "would update  $f" }
    else {
      New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null
      Copy-Item $s $d -Force
      Info "updated  $f"
    }
    $pulled++
  }
  if ($pulled -eq 0) { Ok 'code already current' } else { Ok "$pulled file(s) $(if($WhatIf){'would be '})updated" }
}

# ------------------------------------------------------------ 2. demo dataset
Step 2 'Regenerate the demo dataset'
if ($NoReseed) {
  Info 'skipped (-NoReseed) - exporting whatever data\store.json currently holds'
} elseif ($WhatIf) {
  Info 'would run seed_demo.py'
} else {
  Push-Location $here
  try {
    $out = & python seed_demo.py 2>&1
    if ($LASTEXITCODE -ne 0) { throw "seed_demo.py failed:`n$out" }
    ($out | Select-Object -Last 8) | ForEach-Object { Info $_ }
    Ok 'demo data rebuilt (dates are relative to today)'
  } finally { Pop-Location }
}

# ------------------------------------------------------------------- 3. deck
Step 3 'Rebuild the overview deck'
if ($NoDeck) {
  Info 'skipped (-NoDeck)'
} elseif ($WhatIf) {
  Info 'would run build_overview.py'
} else {
  Push-Location $here
  try {
    $out = & python build_overview.py 2>&1
    if ($LASTEXITCODE -ne 0) { throw "build_overview.py failed:`n$out" }
    ($out | Select-Object -Last 4) | ForEach-Object { Info $_ }
    Ok 'deck rebuilt'
  } finally { Pop-Location }
}

# ----------------------------------------------------------- 4. safety scan
Step 4 'Safety scan - is anything real about to be published?'

# Build the blocklist from the upstream board itself, so it never goes stale.
$blocked = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

$upstreamStore = Join-Path $Upstream 'data\store.json'
if (Test-Path $upstreamStore) {
  $real = Get-Content $upstreamStore -Raw | ConvertFrom-Json
  foreach ($c in $real.clients) {
    # the display name, and each word of it long enough to be distinctive
    foreach ($t in @($c.name, $c.clientLead, $c.clientLeadEmail)) {
      if ($t) { [void]$blocked.Add($t.Trim()) }
    }
    foreach ($t in ($c.searchTerms -split ',')) {
      $t = $t.Trim()
      if ($t.Length -ge 4) { [void]$blocked.Add($t) }
    }
  }
  foreach ($i in $real.items) {
    foreach ($t in @($i.clientOwner, $i.cssCaseNumber, $i.dcrId)) {
      if ($t -and $t.ToString().Trim().Length -ge 4) { [void]$blocked.Add($t.ToString().Trim()) }
    }
  }
  Info "blocklist derived from upstream store: $($blocked.Count) terms"
} else {
  Warn 'upstream store.json unreadable - falling back to static terms only'
}

# Terms that are always wrong in a public repo, regardless of the board.
# These live in an external file (excluded from the export) rather than inline,
# so the scanner does not match its own blocklist and flag itself.
$blocklistFile = Join-Path $here '.export-blocklist'
if (Test-Path $blocklistFile) {
  $extra = 0
  foreach ($line in (Get-Content $blocklistFile)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    [void]$blocked.Add($t); $extra++
  }
  Info "plus $extra term(s) from .export-blocklist"
} else {
  Warn 'no .export-blocklist found - scanning with derived terms only'
}

# Words that are fine even though they appear on the real board.
$allow = @(
  'Manager 1:1', 'SFMC Team', 'Internal', 'Microsoft', 'Mission Critical',
  'Mission Critical Office 365 Transition', 'Mission Critical Intelligent Cloud'
)
foreach ($a in $allow) { [void]$blocked.Remove($a) }

$textExt = '.py', '.js', '.css', '.html', '.json', '.md', '.ps1', '.txt', '.yml', '.yaml'
$scan = Get-ChildItem $here -Recurse -File |
  Where-Object {
    $_.FullName -notmatch '\\(backups|code-backups|__pycache__|\.git)\\' -and
    $_.Extension -in $textExt -and
    $_.Name -ne 'proposals.json'
  }

$findings = @()
foreach ($f in $scan) {
  $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $text) { continue }
  foreach ($term in $blocked) {
    $idx = $text.IndexOf($term, [StringComparison]::OrdinalIgnoreCase)
    if ($idx -ge 0) {
      $line = ($text.Substring(0, $idx) -split "`n").Count
      $snippet = $text.Substring([Math]::Max(0, $idx - 40), [Math]::Min(110, $text.Length - [Math]::Max(0, $idx - 40))) -replace '\s+', ' '
      $findings += [pscustomobject]@{
        File = $f.FullName.Substring($here.Length + 1)
        Line = $line
        Term = $term
        Context = $snippet.Trim()
      }
    }
  }
}

if ($findings) {
  Write-Host ''
  Write-Host "    REAL DATA DETECTED - $($findings.Count) match(es)" -ForegroundColor Red
  $findings | Select-Object -First 25 | ForEach-Object {
    Write-Host ("      {0}:{1}  [{2}]" -f $_.File, $_.Line, $_.Term) -ForegroundColor Red
    Write-Host ("        …{0}…" -f $_.Context) -ForegroundColor DarkGray
  }
  if ($findings.Count -gt 25) { Warn "…and $($findings.Count - 25) more" }
  Write-Host ''
  if (-not $Force) {
    Write-Host "    Export BLOCKED. Fix the above, or re-run with -Force if these are false positives." -ForegroundColor Red
    exit 2
  }
  Warn 'continuing anyway because -Force was passed'
} else {
  Ok 'clean - no upstream client, contact or case data found'
}

# ---------------------------------------------------------------- 5. mirror
Step 5 'Mirror to the repository folder'

if ($WhatIf) {
  Info "would mirror $here -> $Target"
} else {
  if (Test-Path (Join-Path $Target '.git')) {
    Info 'target is a git repo - .git will be preserved'
  }
  New-Item -ItemType Directory -Force -Path $Target | Out-Null

  # /MIR keeps the target a faithful copy, including deletions.
  # .git is excluded so a repo initialised in the target survives.
  $rc = @(
    $here, $Target, '/MIR',
    '/XD', 'backups', 'code-backups', '__pycache__', '.git',
    '/XF', '*.log', 'proposals.json', '*.tmp', '.export-blocklist',
    '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
  )
  robocopy @rc | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

  $files = Get-ChildItem $Target -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' }
  $mb = ($files | Measure-Object -Property Length -Sum).Sum / 1MB
  Ok ("{0} files, {1:N1} MB" -f $files.Count, $mb)
}

# ---------------------------------------------------------------- summary
Write-Host "`nDone." -ForegroundColor Green
if (-not $WhatIf) {
  Write-Host "  $Target"
  if (Test-Path (Join-Path $Target '.git')) {
    Push-Location $Target
    try {
      $changed = (git status --porcelain 2>$null | Measure-Object).Count
      if ($changed -gt 0) {
        Write-Host "  $changed change(s) staged for review:" -ForegroundColor Yellow
        Write-Host "    cd `"$Target`"; git add -A; git commit -m `"Refresh demo export`""
      } else {
        Write-Host "  repository already up to date" -ForegroundColor DarkGray
      }
    } catch { } finally { Pop-Location }
  } else {
    Write-Host "  Not a git repo yet:" -ForegroundColor DarkGray
    Write-Host "    cd `"$Target`"; git init -b main; git add .; git commit -m `"Initial commit`""
  }
}

# Explicit success. Without this the caller sees robocopy's exit code (1 means
# "files were copied"), which reads as a failure and would break any wrapper
# that checks $LASTEXITCODE. 0 = exported, 2 = blocked by the safety scan.
exit 0

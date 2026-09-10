<#
  Watchdog.ps1 — keeps the SfMC Client Boards server running.

  Checks whether the API answers on the expected port. If not, starts the
  server with pythonw.exe (no console window) fully detached from whatever
  launched it, so it survives Scout closing, terminals closing, and sign-outs
  within the same session.

  Registered as a Scheduled Task by Install-Autostart.ps1:
    - runs at logon
    - repeats every 5 minutes, so a crash self-heals within 5 minutes
  Safe to run by hand at any time; it never starts a second copy.

  Usage
    .\Watchdog.ps1              # start if down, do nothing if up
    .\Watchdog.ps1 -Status      # report only, never start
    .\Watchdog.ps1 -Restart     # stop the current server, then start fresh
#>
[CmdletBinding()]
param(
  [int]    $Port = 0,
  [switch] $Status,
  [switch] $Restart
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$log  = Join-Path $root 'data\watchdog.log'
$server = Join-Path $root 'server.py'

# Per-deployment settings live in instance.json so this script is identical
# across every board instance (production, demo, ...).
$instance = @{ name = 'Client Boards'; port = 8790 }
$instFile = Join-Path $root 'instance.json'
if (Test-Path $instFile) {
  try {
    $j = Get-Content $instFile -Raw | ConvertFrom-Json
    if ($j.name) { $instance.name = $j.name }
    if ($j.port) { $instance.port = [int]$j.port }
  } catch { }
}
if (-not $Port -or $Port -le 0) { $Port = $instance.port }

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
    Add-Content -Path $log -Value $line -Encoding UTF8
    # keep the log from growing forever
    if ((Get-Item $log).Length -gt 256KB) {
      $keep = Get-Content $log -Tail 400
      Set-Content $log -Value $keep -Encoding UTF8
    }
  } catch { }
  Write-Verbose $line
}

function Get-ServerProcess {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if (-not $conn) { return $null }
  Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
}

function Get-OurPythonProcesses {
  # every python/pythonw running THIS folder's server.py on THIS port - matched
  # on both so a second board instance elsewhere is never touched, and
  # unrelated Python work on this machine is left alone. Older processes were
  # launched with a relative path, so accept either form.
  $leaf = Split-Path $server -Leaf
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*--port $Port*" -and
      ($_.CommandLine -like "*$server*" -or $_.CommandLine -like "*$leaf*")
    }
}

function Get-PythonW {
  # resolve the REAL interpreter, not the WindowsApps execution alias, which
  # does not launch reliably from a scheduled task
  try {
    $exe = & python -c "import sys; print(sys.executable)" 2>$null
    if ($exe -and (Test-Path $exe)) {
      $w = Join-Path (Split-Path $exe) 'pythonw.exe'
      if (Test-Path $w) { return $w }
      return $exe
    }
  } catch { }
  $cmd = (Get-Command python -ErrorAction SilentlyContinue)?.Source
  if (-not $cmd) { throw "Python not found on PATH." }
  $w = Join-Path (Split-Path $cmd) 'pythonw.exe'
  if (Test-Path $w) { return $w }
  return $cmd
}

function Test-Api {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/store" -TimeoutSec 5
    return [pscustomobject]@{ ok = $true; clients = @($r.clients).Count; items = @($r.items).Count }
  } catch { return [pscustomobject]@{ ok = $false } }
}

# ---- status -------------------------------------------------------------
$proc = Get-ServerProcess
$api  = Test-Api

if ($Status) {
  if ($api.ok) {
    Write-Host "UP   http://127.0.0.1:$Port/  (PID $($proc.Id), $($api.clients) clients, $($api.items) items)" -ForegroundColor Green
  } elseif ($proc) {
    Write-Host "PORT BUSY but API not answering (PID $($proc.Id), $($proc.ProcessName)) - consider -Restart" -ForegroundColor Yellow
  } else {
    Write-Host "DOWN  nothing listening on $Port" -ForegroundColor Red
  }
  return
}

# ---- restart ------------------------------------------------------------
if ($Restart) {
  $ours = Get-OurPythonProcesses
  foreach ($o in $ours) {
    Write-Log "restart requested - stopping PID $($o.ProcessId)"
    try { Stop-Process -Id $o.ProcessId -Force -ErrorAction Stop } catch { }
  }
  if ($ours) { Start-Sleep -Seconds 2 }
  $proc = $null; $api = [pscustomobject]@{ ok = $false }
}

# ---- already healthy ----------------------------------------------------
if ($api.ok) { Write-Log "ok (PID $($proc.Id))"; return }

# Clear anything of ours that is running but not serving. Do this before every
# start so repeated failures can never stack up multiple half-dead copies.
$ours = Get-OurPythonProcesses
if ($ours) {
  foreach ($o in $ours) {
    Write-Log "clearing stale server PID $($o.ProcessId)"
    try { Stop-Process -Id $o.ProcessId -Force -ErrorAction Stop } catch { }
  }
  Start-Sleep -Seconds 2
}

# port still held by something that isn't ours - leave it alone but report
$proc = Get-ServerProcess
if ($proc) {
  Write-Log "FATAL port $Port held by PID $($proc.Id) ($($proc.ProcessName)) which is not our server"
  throw "Port $Port is in use by $($proc.ProcessName) (PID $($proc.Id)). Free it or run with -Port <other>."
}

# ---- start --------------------------------------------------------------
if (-not (Test-Path $server)) { Write-Log "FATAL server.py not found at $server"; throw "server.py not found" }

$pythonw = Get-PythonW

Write-Log "starting: $pythonw `"$server`" --port $Port"
Start-Process -FilePath $pythonw `
              -ArgumentList @("`"$server`"", '--port', $Port, '--no-browser') `
              -WorkingDirectory $root `
              -WindowStyle Hidden

# confirm it came up (pythonw needs a moment; be patient before declaring failure)
for ($i = 1; $i -le 20; $i++) {
  Start-Sleep -Milliseconds 700
  $api = Test-Api
  if ($api.ok) {
    $p = Get-ServerProcess
    Write-Log "started ok (PID $($p.Id), $($api.items) items)"
    if (-not $env:SFMC_QUIET) {
      Write-Host "$($instance.name) is up: http://127.0.0.1:$Port/" -ForegroundColor Green
    }
    return
  }
}
Write-Log "FAILED to confirm startup after 14s - check data\server.log"
throw "Server did not come up on port $Port - run .\Watchdog.ps1 -Status for detail"

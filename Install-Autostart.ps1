<#
  Install-Autostart.ps1 — makes SfMC Client Boards start on its own and stay up.

  Registers a Scheduled Task that:
    - starts the server when you log on
    - re-checks every 5 minutes and restarts it if it died
    - runs hidden, with no console window and no Scout dependency

  No admin rights needed; the task runs as you, in your session.

  Usage
    .\Install-Autostart.ps1            # install or update
    .\Install-Autostart.ps1 -Remove    # uninstall
    .\Install-Autostart.ps1 -Status    # show task + server state
#>
[CmdletBinding()]
param(
  [string] $TaskName = '',
  [int]    $Port = 0,
  [switch] $Remove,
  [switch] $Status
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$watchdog = Join-Path $root 'Watchdog.ps1'

# Task name and port come from instance.json so each board folder registers
# its own distinct scheduled task.
$instFile = Join-Path $root 'instance.json'
if (Test-Path $instFile) {
  try {
    $j = Get-Content $instFile -Raw | ConvertFrom-Json
    if (-not $TaskName -and $j.taskName) { $TaskName = $j.taskName }
    if ((-not $Port -or $Port -le 0) -and $j.port) { $Port = [int]$j.port }
  } catch { }
}
if (-not $TaskName) { $TaskName = 'SfMC Client Boards' }
if (-not $Port -or $Port -le 0) { $Port = 8790 }

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Yellow
  } else { Write-Host "No task named '$TaskName'." }
  Write-Host "The server itself is untouched - stop it with:  Get-NetTCPConnection -LocalPort $Port -State Listen"
  return
}

if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    $i = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task    : $TaskName [$($t.State)]" -ForegroundColor Cyan
    Write-Host "Last run: $($i.LastRunTime)  result=$($i.LastTaskResult)"
    Write-Host "Next run: $($i.NextRunTime)"
  } else {
    Write-Host "Task '$TaskName' is not installed." -ForegroundColor Yellow
  }
  & $watchdog -Status -Port $Port
  return
}

if (-not (Test-Path $watchdog)) { throw "Watchdog.ps1 not found next to this script." }

# Prefer PowerShell 7 if present; fall back to Windows PowerShell.
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $pwsh) { $pwsh = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }

$action = New-ScheduledTaskAction -Execute $pwsh `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`" -Port $Port" `
  -WorkingDirectory $root

# at logon, plus a repeating check so a crash self-heals
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
             -RepetitionInterval (New-TimeSpan -Minutes 5)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger @($tLogon, $tRepeat) -Settings $settings -Principal $principal `
  -Description 'Keeps the SfMC Client Boards server running. Checks every 5 minutes and restarts it if it stopped.' `
  -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName'." -ForegroundColor Green
Write-Host "  - starts at logon"
Write-Host "  - re-checks every 5 minutes and restarts if needed"
Write-Host "  - runs hidden; no Scout, no terminal, no console window required"

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4
& $watchdog -Status -Port $Port

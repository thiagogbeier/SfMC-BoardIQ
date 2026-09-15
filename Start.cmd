@echo off
REM ============================================================================
REM  Start.cmd - double-clickable launcher for SfMC:BoardIQ
REM
REM  Exists because a folder extracted from a downloaded or emailed .zip hits
REM  two Windows guard rails that stop PowerShell scripts dead:
REM
REM    1. Mark of the Web - every extracted file carries a Zone.Identifier
REM       stream marking it as internet-sourced, so PowerShell refuses to run
REM       the .ps1 files at all.
REM    2. Execution policy - the default policy blocks unsigned local scripts.
REM
REM  This wrapper clears both for THIS FOLDER ONLY, then hands over to
REM  Start-Boards.ps1. Nothing is changed machine-wide.
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo   SfMC:BoardIQ
echo   ============
echo.

REM --- is Python available? ---------------------------------------------------
where python >nul 2>&1
if errorlevel 1 (
  echo   [X] Python was not found on PATH.
  echo.
  echo       Install Python 3.9 or newer from https://www.python.org/downloads/
  echo       and tick "Add python.exe to PATH" during setup.
  echo.
  echo       If the Microsoft Store opens instead of Python running, turn off
  echo       the alias: Settings ^> Apps ^> Advanced app settings ^>
  echo       App execution aliases ^> switch off python.exe and python3.exe
  echo.
  pause
  exit /b 1
)

REM --- clear Mark of the Web on this folder -----------------------------------
echo   Preparing files...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

REM --- start ------------------------------------------------------------------
echo   Starting the board...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Boards.ps1"

echo.
echo   The server has stopped.
pause

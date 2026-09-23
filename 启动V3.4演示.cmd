@echo off
setlocal
set "JIAOYING_PORT=8767"
if exist "%~dp0tmp\before-v34-state.json" set "JIAOYING_STATE_FILE=%~dp0tmp\before-v34-state.json"
set "JIAOYING_NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined JIAOYING_NODE set "JIAOYING_NODE=%%N"
if not defined JIAOYING_NODE set "JIAOYING_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%JIAOYING_NODE%" (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
"%JIAOYING_NODE%" "%~dp0launcher.mjs"
if errorlevel 1 pause
endlocal

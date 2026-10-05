@echo off
setlocal
chcp 65001 >nul
set "JIAOYING_NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined JIAOYING_NODE set "JIAOYING_NODE=%%N"
if not defined JIAOYING_NODE set "JIAOYING_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%JIAOYING_NODE%" (
  echo 未找到现有 Node.js 22 或以上版本。启动器不会自动下载安装。
  pause
  exit /b 1
)
"%JIAOYING_NODE%" -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo 需要 Node.js 22 或以上版本，当前服务尚未启动。
  pause
  exit /b 1
)
pushd "%~dp0"
echo 正在显式开启同 Wi-Fi 协同演练。此窗口会显示房间加入链接。
echo 不修改防火墙，不开启公网，不读取本机旧演练。按 Ctrl+C 关闭服务。
"%JIAOYING_NODE%" "%~dp0lan-server.mjs"
set "JIAOYING_EXIT=%ERRORLEVEL%"
popd
if not "%JIAOYING_EXIT%"=="0" pause
endlocal

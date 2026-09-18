@echo off
REM Dest launcher. Start Menu uses start-anchortrails.vbs so no console stays open.
set VSCODE_SKIP_PRELAUNCH=1
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set "PATH=D:\code-oss\.tools\node-v24.18.0-win-x64;%PATH%"
cd /d "D:\code-oss"
start "" "D:\code-oss\.build\electron\AnchorTrails.exe" . --extensionDevelopmentPath="D:\code-oss\extensions\anchortrails" --enable-proposed-api=anchortrails.anchortrails --disable-extension=vscode.vscode-api-tests --disable-extension=GitHub.copilot-chat --disable-extension=GitHub.copilot --disable-workspace-trust %*

' Silent dest launch. Start Menu must not point at AnchorTrails.exe
' alone — that build tells you to run scripts\code.bat.
Option Explicit
Dim sh, root, exe, ext, node, args
Set sh = CreateObject("WScript.Shell")
root = "D:\code-oss"
exe = root & "\.build\electron\AnchorTrails.exe"
ext = root & "\extensions\anchortrails"
node = root & "\.tools\node-v24.18.0-win-x64"
sh.Environment("Process")("VSCODE_SKIP_PRELAUNCH") = "1"
sh.Environment("Process")("NODE_ENV") = "development"
sh.Environment("Process")("VSCODE_DEV") = "1"
sh.Environment("Process")("VSCODE_CLI") = "1"
sh.Environment("Process")("PATH") = node & ";" & sh.Environment("Process")("PATH")
sh.CurrentDirectory = root
args = """" & exe & """ ." _
  & " --extensionDevelopmentPath=""" & ext & """" _
  & " --enable-proposed-api=anchortrails.anchortrails" _
  & " --disable-extension=vscode.vscode-api-tests" _
  & " --disable-extension=GitHub.copilot-chat" _
  & " --disable-extension=GitHub.copilot" _
  & " --disable-workspace-trust"
sh.Run args, 1, False

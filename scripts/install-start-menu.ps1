# Rewrite the Start Menu tile so it launches dest, not the bare Electron exe.
$ErrorActionPreference = "Stop"
$lnkPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\AnchorTrails.lnk"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
$vbs = "D:\code-oss\start-anchortrails.vbs"
$exe = "D:\code-oss\.build\electron\AnchorTrails.exe"
if (-not (Test-Path $vbs)) { throw "missing $vbs" }
if (-not (Test-Path $exe)) { throw "missing $exe" }
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = $wscript
$lnk.Arguments = "//nologo `"$vbs`""
$lnk.WorkingDirectory = "D:\code-oss"
$lnk.IconLocation = "$exe,0"
$lnk.WindowStyle = 1
$lnk.Description = "AnchorTrails"
$lnk.Save()
Write-Output $lnkPath

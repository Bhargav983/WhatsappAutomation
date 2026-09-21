$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap(64,64)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.Clear([Drawing.Color]::Transparent)
$green = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(20,160,95))
$graphics.FillEllipse($green, 2, 2, 60, 60)
$font = New-Object Drawing.Font('Segoe UI', 21, [Drawing.FontStyle]::Bold)
$graphics.DrawString('WA', $font, [Drawing.Brushes]::White, 3, 13)
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconPath = Join-Path $appRoot 'wa-akg.ico'
$stream = [IO.File]::Create($iconPath)
try { $icon.Save($stream) } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $green.Dispose(); $font.Dispose() }
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'WA-AKG.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $appRoot 'Start-WA-AKG.ps1') + '"'
$shortcut.WorkingDirectory = $appRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Start WA-AKG and open the dashboard'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output "Created: $shortcutPath"

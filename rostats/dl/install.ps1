# Installateur RoStats pour Windows
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://rostats.vercel.app/dl'
$dir = Join-Path $env:LOCALAPPDATA 'RoStats'
$tmp = Join-Path $env:TEMP 'rostats-install'
Write-Host ''
Write-Host '  rostats  -  installation' -ForegroundColor Magenta
Write-Host ''
Get-Process RoStats -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800
New-Item -ItemType Directory -Force $dir, $tmp | Out-Null
if (-not (Test-Path (Join-Path $dir 'RoStats.exe'))) {
  Write-Host '  [1/3] Telechargement du moteur (environ 100 Mo)...'
  Invoke-WebRequest 'https://github.com/electron/electron/releases/download/v31.7.7/electron-v31.7.7-win32-x64.zip' -OutFile "$tmp\engine.zip" -UseBasicParsing
  Expand-Archive "$tmp\engine.zip" -DestinationPath $dir -Force
  Move-Item (Join-Path $dir 'electron.exe') (Join-Path $dir 'RoStats.exe') -Force
  Remove-Item (Join-Path $dir 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
  Write-Host '  [2/3] Icone de l application...'
  Invoke-WebRequest "$base/icon.ico" -OutFile (Join-Path $dir 'icon.ico') -UseBasicParsing
  try {
    Invoke-WebRequest 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' -OutFile "$tmp\rcedit.exe" -UseBasicParsing
    & "$tmp\rcedit.exe" (Join-Path $dir 'RoStats.exe') --set-icon (Join-Path $dir 'icon.ico') --set-version-string ProductName RoStats --set-version-string FileDescription RoStats | Out-Null
  } catch { Write-Host '      (icone : etape ignoree)' }
} else {
  Write-Host '  [1/3] Moteur deja installe'
  Write-Host '  [2/3] Icone deja installee'
}
Write-Host '  [3/3] Telechargement de RoStats...'
Invoke-WebRequest "$base/app.asar.bin" -OutFile (Join-Path $dir 'resources\app.asar') -UseBasicParsing
$ws = New-Object -ComObject WScript.Shell
foreach ($lnk in @([Environment]::GetFolderPath('Desktop') + '\RoStats.lnk', [Environment]::GetFolderPath('Programs') + '\RoStats.lnk')) {
  $s = $ws.CreateShortcut($lnk); $s.TargetPath = (Join-Path $dir 'RoStats.exe'); $s.WorkingDirectory = $dir; $s.IconLocation = (Join-Path $dir 'icon.ico'); $s.Save()
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host '  RoStats est installe ! Raccourci cree sur le Bureau.' -ForegroundColor Green
Start-Process (Join-Path $dir 'RoStats.exe')

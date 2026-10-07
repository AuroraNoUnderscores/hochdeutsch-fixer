# Removes Hochdeutsch-Fixer's file helper (what install.ps1 put there).
$name = 'hochdeutsch_fixer'
Remove-Item -Force -ErrorAction SilentlyContinue -Path "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path (Join-Path $env:LOCALAPPDATA 'Hochdeutsch-Fixer')
Write-Host 'Removed. Firefox asks for PDFs from this computer again.'

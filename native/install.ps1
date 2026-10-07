# Installs Hochdeutsch-Fixer's file helper for this Windows user (no admin
# needed): copies it to %LOCALAPPDATA%\Hochdeutsch-Fixer, builds
# hdfx_file.exe there when the C# compiler of .NET Framework 4 is present
# (every Windows 10 and 11 has it), and tells Firefox where it is. Run it
# through install.bat; uninstall.bat takes it all away again.
$ErrorActionPreference = 'Stop'
$name = 'hochdeutsch_fixer'
$dir = Join-Path $env:LOCALAPPDATA 'Hochdeutsch-Fixer'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -Force -Path (Join-Path $PSScriptRoot 'hdfx_file.ps1'), (Join-Path $PSScriptRoot 'hdfx_file.bat') -Destination $dir

# the fast helper where it can be built, else the PowerShell one
$target = Join-Path $dir 'hdfx_file.bat'
$exe = Join-Path $dir 'hdfx_file.exe'
$csc = @('Framework64', 'Framework') | ForEach-Object { Join-Path $env:WINDIR "Microsoft.NET\$_\v4.0.30319\csc.exe" } |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($csc) {
  & $csc /nologo /optimize /target:exe "/out:$exe" (Join-Path $PSScriptRoot 'hdfx_file.cs') | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $exe)) { $target = $exe }
}

# Firefox finds the helper through this file, named in the registry
$manifest = Join-Path $dir "$name.json"
$json = [ordered]@{
  name = $name
  description = 'Hochdeutsch-Fixer: opens a PDF from this computer for the extension'
  path = $target
  type = 'stdio'
  allowed_extensions = @('hochdeutsch-fixer@addons.local')
} | ConvertTo-Json
[IO.File]::WriteAllText($manifest, $json)
New-Item -Force -Path "HKCU:\Software\Mozilla\NativeMessagingHosts\$name" -Value $manifest | Out-Null

Write-Host "Installed: $target"
Write-Host 'PDFs from this computer now open converted in Firefox without asking.'

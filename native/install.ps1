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

# Self-test: what Firefox will do, step by step. The registry names the
# manifest, the manifest names the helper, and the helper reads a small PDF.
function Test-Helper {
  $key = "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"
  $item = Get-Item -Path $key -ErrorAction SilentlyContinue
  $named = if ($item) { $item.GetValue('') } else { $null }
  if ($named -ne $manifest) { return "the registry names '$named', not $manifest" }
  try { $m = [IO.File]::ReadAllText($manifest) | ConvertFrom-Json } catch { return "the manifest is not valid JSON: $_" }
  if ($m.name -ne $name -or @($m.allowed_extensions) -notcontains 'hochdeutsch-fixer@addons.local') { return 'the manifest names the wrong helper or extension' }
  if (-not (Test-Path $m.path)) { return "the helper is missing: $($m.path)" }
  $pdf = Join-Path $env:TEMP 'hdfx-selftest.pdf'
  [IO.File]::WriteAllBytes($pdf, [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n%%EOF`n"))
  $req = [Text.Encoding]::UTF8.GetBytes('{"path":"' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pdf)) + '"}')
  $psi = New-Object Diagnostics.ProcessStartInfo
  if ($m.path -like '*.bat') { $psi.FileName = 'cmd.exe'; $psi.Arguments = '/c "' + $m.path + '"' } else { $psi.FileName = $m.path }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  try { $p = [Diagnostics.Process]::Start($psi) } catch { return "the helper did not start: $_" }
  $p.StandardInput.BaseStream.Write([BitConverter]::GetBytes([int]$req.Length), 0, 4)
  $p.StandardInput.BaseStream.Write($req, 0, $req.Length)
  $p.StandardInput.Close()
  $out = New-Object IO.MemoryStream
  $p.StandardOutput.BaseStream.CopyTo($out)
  $err = $p.StandardError.ReadToEnd()
  [void]$p.WaitForExit(10000)
  Remove-Item -Force -ErrorAction SilentlyContinue $pdf
  $bytes = $out.ToArray()
  $text = ''
  for ($at = 0; $at + 4 -le $bytes.Length; ) {
    $n = [BitConverter]::ToInt32($bytes, $at)
    $text += [Text.Encoding]::UTF8.GetString($bytes, $at + 4, [Math]::Min($n, $bytes.Length - $at - 4)) + "`n"
    $at += 4 + $n
  }
  if ($text -notmatch '"chunk"' -or $text -notmatch '"done"') { return "the helper answered: '$($text.Trim())' $err".Trim() }
  return $null
}
$problem = Test-Helper
if ($problem) {
  Write-Host "Self-test FAILED: $problem" -ForegroundColor Red
  Write-Host 'Firefox will keep asking for local PDFs. Please send this message to the extension''s author.'
} else {
  Write-Host 'Self-test passed: PDFs from this computer now open converted in Firefox without asking.'
  Write-Host '(Reload the PDF tab, or open the PDF again.)'
}

# Hochdeutsch-Fixer's file helper (Windows; hdfx_file.bat starts it). Firefox
# lets no extension read a file on this computer, so it starts this script
# when a PDF from disk is opened, and only for this extension (see the
# manifest install.ps1 writes). It reads that one PDF, hands it over and
# exits: nothing keeps running.
#
# Firefox's native messaging: each message is a 32-bit length in the
# machine's byte order, then that many bytes of JSON. In: {"path": base64 of
# the path}. Out: {"chunk": base64} per 512 KiB (a message to the extension
# may be at most 1 MB), then {"done": true, "size": bytes}; or {"error": "..."}.
# Written for Windows PowerShell 5.1, which every Windows 10 and 11 has.
$ErrorActionPreference = 'Stop'
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-Exact([int]$n) {
  $buf = New-Object byte[] $n
  $got = 0
  while ($got -lt $n) {
    $r = $stdin.Read($buf, $got, $n - $got)
    if ($r -le 0) { exit 0 }
    $got += $r
  }
  return ,$buf
}
function Send([string]$json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}
function Fail([string]$why) { Send ('{"error":"' + $why + '"}'); exit 0 }

$len = [BitConverter]::ToInt32((Read-Exact 4), 0)
if ($len -le 0 -or $len -ge 65536) { exit 0 }
$req = [Text.Encoding]::UTF8.GetString((Read-Exact $len))
if ($req -notmatch '"path"\s*:\s*"([A-Za-z0-9+/=]*)"') { Fail 'bad request' }
try { $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1])) } catch { Fail 'bad request' }

# only a PDF: its name, a file, and "%PDF-" near its start
if ([IO.Path]::GetExtension($path) -ne '.pdf') { Fail 'not a PDF' }
if (-not [IO.File]::Exists($path)) { Fail 'not found' }
try { $file = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite') } catch { Fail 'not found' }
try {
  if ($file.Length -gt 536870912) { Fail 'too large' }
  $head = New-Object byte[] 1024
  $n = $file.Read($head, 0, $head.Length)
  if (-not [Text.Encoding]::GetEncoding(28591).GetString($head, 0, $n).Contains('%PDF-')) { Fail 'not a PDF' }
  [void]$file.Seek(0, 'Begin')
  $buf = New-Object byte[] 524288
  while (($n = $file.Read($buf, 0, $buf.Length)) -gt 0) {
    Send ('{"chunk":"' + [Convert]::ToBase64String($buf, 0, $n) + '"}')
  }
  Send ('{"done":true,"size":' + $file.Length + '}')
} finally { $file.Dispose() }

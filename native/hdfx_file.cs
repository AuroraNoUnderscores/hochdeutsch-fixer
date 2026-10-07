// Hochdeutsch-Fixer's file helper (Windows). install.ps1 builds it into
// hdfx_file.exe with the C# compiler of .NET Framework 4, which every
// Windows 10 and 11 has; it starts in milliseconds, where PowerShell
// (hdfx_file.ps1, the fallback) takes about half a second. Same protocol and
// checks as hdfx_file.sh and hdfx_file.ps1; written for C# 5, that compiler's.
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

static class HdfxFile {
  static Stream stdin = Console.OpenStandardInput(), stdout = Console.OpenStandardOutput();

  static byte[] ReadExact(int n) {
    var buf = new byte[n];
    for (int got = 0; got < n; ) {
      int r = stdin.Read(buf, got, n - got);
      if (r <= 0) Environment.Exit(0);
      got += r;
    }
    return buf;
  }

  static void Send(string json) {
    var bytes = Encoding.UTF8.GetBytes(json);
    stdout.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
    stdout.Write(bytes, 0, bytes.Length);
    stdout.Flush();
  }

  static int Fail(string why) { Send("{\"error\":\"" + why + "\"}"); return 0; }

  static int Main() {
    int len = BitConverter.ToInt32(ReadExact(4), 0);
    if (len <= 0 || len >= 65536) return 0;
    var m = Regex.Match(Encoding.UTF8.GetString(ReadExact(len)), "\"path\"\\s*:\\s*\"([A-Za-z0-9+/=]*)\"");
    if (!m.Success) return Fail("bad request");
    string path;
    try { path = Encoding.UTF8.GetString(Convert.FromBase64String(m.Groups[1].Value)); }
    catch (FormatException) { return Fail("bad request"); }

    // only a PDF: its name, a file, and "%PDF-" near its start
    if (!string.Equals(Path.GetExtension(path), ".pdf", StringComparison.OrdinalIgnoreCase)) return Fail("not a PDF");
    if (!File.Exists(path)) return Fail("not found");
    FileStream file;
    try { file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); }
    catch (Exception) { return Fail("not found"); }
    using (file) {
      if (file.Length > 536870912) return Fail("too large");
      var head = new byte[1024];
      int n = file.Read(head, 0, head.Length);
      if (Encoding.GetEncoding(28591).GetString(head, 0, n).IndexOf("%PDF-", StringComparison.Ordinal) < 0) return Fail("not a PDF");
      file.Seek(0, SeekOrigin.Begin);
      var buf = new byte[524288];
      while ((n = file.Read(buf, 0, buf.Length)) > 0)
        Send("{\"chunk\":\"" + Convert.ToBase64String(buf, 0, n) + "\"}");
      Send("{\"done\":true,\"size\":" + file.Length + "}");
    }
    return 0;
  }
}

"""Drive a headless Firefox-engine browser (Zen by default) over WebDriver BiDi,
with nothing but the standard library: install the extension, open pages,
evaluate script, take screenshots.

    z = Zen(extensions=[path]); z.nav(url); z.js(expr); z.shot(path); z.close()

BROWSER may point at another Firefox build. The extension gets a fixed internal
UUID, so its moz-extension:// URLs are the same in every run."""
import base64, json, os, socket, struct, subprocess, tempfile, time, shutil

BROWSER = os.environ.get('BROWSER', r"C:\Program Files\Zen Browser\zen.exe")

class Zen:
    def __init__(self, extensions=(), port=9333, prefs=None, width=1280, height=900):
        self.prof = tempfile.mkdtemp(prefix="zenbidi")
        p = {"browser.shell.checkDefaultBrowser": False, "xpinstall.signatures.required": False,
             "browser.aboutwelcome.enabled": False, "datareporting.policy.dataSubmissionEnabled": False,
             "browser.startup.homepage_override.mstone": "ignore",
             "extensions.webextensions.uuids": json.dumps({"hochdeutsch-fixer@addons.local": "0d0d0d0d-0000-4000-8000-000000000001"}), **(prefs or {})}
        with open(os.path.join(self.prof, "user.js"), "w") as f:
            for k, v in p.items(): f.write(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n")
        self.proc = subprocess.Popen([BROWSER, "--headless", "--width", str(width), "--height", str(height),
                                      "--remote-debugging-port", str(port), "--profile", self.prof, "--no-remote"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            try: self.s = socket.create_connection(("127.0.0.1", port)); break
            except OSError: time.sleep(0.5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f"GET /session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf: buf += self.s.recv(4096)
        assert b" 101 " in buf.split(b"\r\n")[0], buf[:200]
        self.rest = buf.split(b"\r\n\r\n", 1)[1]
        self.id = 0
        self.events = []
        self.cmd("session.new", {"capabilities": {}})
        self.cmd("session.subscribe", {"events": ["log.entryAdded"]})
        self.ext = [self.cmd("webExtension.install", {"extensionData": {"type": "path", "path": e}})["extension"] for e in extensions]
        self.ctx = self.cmd("browsingContext.getTree", {})["contexts"][0]["context"]
        self.cmd("browsingContext.setViewport", {"context": self.ctx, "viewport": {"width": width, "height": height}})

    def _exact(self, n):
        while len(self.rest) < n: self.rest += self.s.recv(1 << 20)
        out, self.rest = self.rest[:n], self.rest[n:]; return out
    def _send(self, obj):
        data = json.dumps(obj).encode(); mask = os.urandom(4); n = len(data)
        hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    def _recv(self):
        msg = b""
        while True:
            b1, b2 = self._exact(2); n = b2 & 0x7f
            if n == 126: n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127: n = struct.unpack(">Q", self._exact(8))[0]
            msg += self._exact(n)
            if b1 & 0x80: return json.loads(msg)
    def cmd(self, method, params):
        self.id += 1; self._send({"id": self.id, "method": method, "params": params})
        while True:
            m = self._recv()
            if m.get("id") == self.id:
                if m.get("type") == "error": raise RuntimeError(f"{method}: {m.get('error')}: {m.get('message')}")
                return m["result"]
            if m.get("type") == "event": self.events.append(m)
    def nav(self, url, wait="complete"):
        return self.cmd("browsingContext.navigate", {"context": self.ctx, "url": url, "wait": wait})
    def js(self, expr, await_promise=True):
        r = self.cmd("script.evaluate", {"expression": expr, "target": {"context": self.ctx}, "awaitPromise": await_promise,
                                          "resultOwnership": "none", "serializationOptions": {"maxDomDepth": 0}})
        if r.get("type") == "exception": raise RuntimeError(r["exceptionDetails"]["text"])
        res = r["result"]; return res.get("value", res.get("type"))
    def wait(self, expr, timeout=60, every=0.5):
        end = time.time() + timeout
        while time.time() < end:
            try:
                v = self.js(expr)
                if v and v not in ("undefined", "null"): return v
            except RuntimeError: pass
            time.sleep(every)
        return None
    def shot(self, path):
        d = self.cmd("browsingContext.captureScreenshot", {"context": self.ctx})["data"]
        open(path, "wb").write(base64.b64decode(d)); return path
    def logs(self):
        out = [e["params"].get("text") for e in self.events if e.get("method") == "log.entryAdded"]
        self.events.clear(); return out
    def close(self):
        try: self.proc.kill()
        except Exception: pass
        shutil.rmtree(self.prof, ignore_errors=True)

"""Copy the browser's own PDF viewer (pdf.js) into pdfjs/, so that PDFs shown by
this extension look and behave exactly like the built-in viewer.

The files come from the installed browser's omni.ja, so they are the same
version as the viewer the browser would show. Rerun after a browser update:

    py tools/sync_pdfjs.py ["C:/Program Files/Zen Browser"]

Then a few small, checked patches are applied (each must match exactly once):
- viewer.mjs: resource://pdf.js/ URLs point into the extension instead;
- viewer.css and the theme CSS: chrome:// imports point to copied files;
- pdf.mjs: three hooks through which pdfpage.mjs rewrites the text that is
  drawn, selected and searched (see HOOKS below).
pdf.js is Apache-2.0 (licence header in pdfjs/web/viewer.html); the theme CSS
and pdfFeaturesNotification.mjs are MPL-2.0.
"""
import base64, json, re, shutil, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pdfjs"
APP = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Program Files\Zen Browser")
JARS = [zipfile.ZipFile(APP / "omni.ja"), zipfile.ZipFile(APP / "browser" / "omni.ja")]
NAMES = [(z, n) for z in JARS for n in z.namelist()]


def read(name):
    for z in JARS:
        try: return z.read(name)
        except KeyError: pass
    raise KeyError(name)


def chrome(url):
    """chrome://global/skin/x.css -> jar entry, found by its path after the package."""
    m = re.match(r"chrome://([\w-]+)/(content|skin)/(.+)$", url)
    pkg, kind, rest = m.groups()
    hits = [n for z, n in NAMES if n.endswith("/" + rest) and (pkg in n.split("/") or kind == "content")]
    hits = [n for n in hits if (f"/{pkg}/" in n or n.startswith(f"chrome/{pkg}/") or pkg == "browser")] or hits
    if len(hits) != 1:
        hits = [n for n in hits if ("skin/classic" in n) == (kind == "skin")]
    assert len(hits) == 1, (url, hits)
    return hits[0]


def prefs():
    """The browser's default prefs, as the built-in viewer sees them (later files win)."""
    out = {}
    for name in ("defaults/pref/PdfJsDefaultPrefs.js", "defaults/preferences/firefox.js"):
        try: text = read(name).decode("utf-8")
        except KeyError: continue
        for k, v in re.findall(r'^\s*pref\("([^"]+)",\s*(.+?)\);', text, re.M):
            v = re.sub(r",\s*(locked|sticky)\s*$", "", v)       # pref("x", false, locked)
            try: out[k] = json.loads(v)
            except ValueError: pass
    return out


PREFS = {}
PLATFORMS = ("windows", "linux", "macos")
UNKNOWN = set()


def resolve(css, platform):
    """Media features only the browser's own pages may use, settled for one
    platform from the default prefs. (width >= 0px) is always true and
    (width < 0px) never, and both stay valid wherever the feature stood."""
    yes, no = "(width >= 0px)", "(width < 0px)"
    def pref(m):
        name, value = m.group(1), m.group(2)
        if name not in PREFS:
            UNKNOWN.add(name)
            return no
        have = PREFS[name]
        return yes if (have == json.loads(value.replace("'", '"')) if value else bool(have)) else no
    css = re.sub(r"""-moz-(?:bool-)?pref\(\s*["']([^"']+)["']\s*(?:,\s*([^)]+?)\s*)?\)""", pref, css)
    css = re.sub(r"\(\s*-moz-platform:\s*([\w-]+)\s*\)", lambda m: yes if m.group(1) == platform else no, css)
    css = re.sub(r"\(\s*-moz-windows-mica\s*\)", no, css)
    css = re.sub(r"\(\s*-moz-system-dark-theme\s*\)", "(prefers-color-scheme: dark)", css)
    left = re.findall(r"@(?:media|import)[^{;]*?\(\s*(-moz-[\w-]+)", css)
    assert not left, f"unhandled browser-only media features: {sorted(set(left))}"
    return css


def copy_css(url, done, platform):
    """Copy a chrome:// stylesheet and everything it @imports into pdfjs/skin/<platform>/."""
    name = url.rsplit("/", 1)[1]
    if name in done: return name
    done.add(name)
    css = resolve(read(chrome(url)).decode("utf-8"), platform)
    for imp in re.findall(r'@import url\("?(chrome://[^")]+)"?\)', css):
        if not imp.startswith("chrome://global/"):
            # the viewer, a page, cannot load these (Zen's window theme, imported by
            # its design tokens): in the browser's viewer they stay empty, so here too
            css = re.sub(r'@import url\("?' + re.escape(imp) + r'"?\)[^;]*;', f"/* {imp.split('://', 1)[1]}: not loaded by the viewer */", css)
            continue
        css = css.replace(imp, copy_css(imp, done, platform))
    # other files a rule points to (Zen's backdrop filters): inlined, fragment kept
    for ref in sorted(set(re.findall(r'url\("?(chrome://[^")#]+\.(?:svg|png))(?:#[^")]*)?"?\)', css))):
        kind = "image/svg+xml" if ref.endswith(".svg") else "image/png"
        css = css.replace(ref, f"data:{kind};base64," + base64.b64encode(read(chrome(ref))).decode())
    assert "chrome://" not in css and "resource://" not in css, f"{name} still links to the browser"
    (OUT / "skin" / platform / name).write_text(css, encoding="utf-8")
    return name


def patch(path, old, new, count=1):
    text = path.read_text(encoding="utf-8")
    n = text.count(old)
    assert n == count, f"{path.name}: expected {count} of {old[:60]!r}, found {n}"
    path.write_text(text.replace(old, new), encoding="utf-8")


# Hooks into pdf.mjs. globalThis.__hdfx is set by pdfpage.mjs; without it the
# viewer behaves exactly as shipped.
HOOKS = [
    # 1. Before a page is drawn, its rewritten text must be ready.
    ("Promise.all([intentState.displayReadyCapability.promise, optionalContentConfigPromise]).then(([transparency, optionalContentConfig]) => {",
     "Promise.all([intentState.displayReadyCapability.promise, optionalContentConfigPromise, globalThis.__hdfx?.prepare(this)]).then(([transparency, optionalContentConfig]) => {"),
    ("      internalRenderTask.initializeGraphics({\n        transparency,\n        optionalContentConfig\n      });",
     "      internalRenderTask.initializeGraphics({\n        transparency,\n        optionalContentConfig\n      });\n      if (internalRenderTask.gfx) internalRenderTask.gfx.__hdfx = globalThis.__hdfx?.canvas(this, intentState.operatorList);"),
    # 2. Drawn text: the glyphs of a changed word are swapped, the run keeps its width.
    ("  showText(opIdx, glyphs) {\n    if (this.dependencyTracker) {",
     "  showText(opIdx, glyphs) {\n    const hd = this.__hdfx?.(this, glyphs);\n    if (hd) {\n      const c = this.current, h = c.textHScale, x0 = c.x, y0 = c.y;\n      c.textHScale = h * hd.scale;\n      try {\n        this.__hdfxShowText(opIdx, hd.glyphs);\n      } finally {\n        c.textHScale = h;\n      }\n      if (hd.more?.length) {\n        const x1 = c.x, y1 = c.y;\n        for (const m of hd.more) {\n          c.x = x0; c.y = y0 + m.dy; c.textHScale = h * m.scale;\n          try { this.__hdfxShowText(opIdx, m.glyphs); } finally { c.textHScale = h; }\n        }\n        c.x = x1; c.y = y1;\n      }\n      return;\n    }\n    return this.__hdfxShowText(opIdx, glyphs);\n  }\n  __hdfxShowText(opIdx, glyphs) {\n    if (this.dependencyTracker) {"),
    # 2b. A letter the document's font does not have is drawn in the installed font of its family.
    ("        if (simpleFillText && !accent) {\n          ctx.fillText(character, scaledX, scaledY);",
     "        if (simpleFillText && !accent) {\n          if (glyph.hdfxFont) {\n            const f = ctx.font;\n            ctx.font = glyph.hdfxFont(f);\n            ctx.fillText(character, scaledX, scaledY);\n            ctx.font = f;\n          } else\n          ctx.fillText(character, scaledX, scaledY);"),
    # 3. Selectable and searchable text (the text layer) reads the rewritten words.
    ("  streamTextContent({\n    includeMarkedContent = false,\n    disableNormalization = false\n  } = {}) {\n",
     "  streamTextContent({\n    includeMarkedContent = false,\n    disableNormalization = false,\n    __hdfxRaw = false\n  } = {}) {\n    if (!__hdfxRaw && globalThis.__hdfx) return globalThis.__hdfx.textStream(this, { includeMarkedContent, disableNormalization });\n"),
]


def main():
    if OUT.exists(): shutil.rmtree(OUT)
    base = "chrome/pdfjs/content/"
    keep = ("build/pdf.mjs", "build/pdf.worker.mjs", "web/viewer.html", "web/viewer.mjs", "web/viewer.css",
            "web/images/", "web/cmaps/", "web/standard_fonts/", "web/iccs/", "web/wasm/", "pdfFeaturesNotification.mjs")
    n = 0
    for z, name in NAMES:
        rel = name[len(base):] if name.startswith(base) else None
        if rel and not name.endswith("/") and rel.startswith(keep):
            p = OUT / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(z.read(name)); n += 1
    for z, name in NAMES:   # the viewer's strings, every locale the browser has
        m = re.match(r"localization/([^/]+)/toolkit/pdfviewer/viewer\.ftl$", name)
        if m:
            p = OUT / "locale" / m.group(1) / "viewer.ftl"; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(z.read(name)); n += 1
    (OUT / "skin").mkdir()
    (OUT / "skin" / "pdf.svg").write_bytes(read(chrome("chrome://global/skin/icons/pdf.svg")))
    PREFS.update(prefs())
    css = (OUT / "web" / "viewer.css").read_text(encoding="utf-8")
    for platform in PLATFORMS:     # one stylesheet per platform; pdfview.js picks one
        (OUT / "skin" / platform).mkdir()
        out, done = resolve(css, platform), set()
        for imp in re.findall(r'@import url\("?(chrome://[^")]+)"?\)', out):
            out = out.replace(imp, f"../skin/{platform}/" + copy_css(imp, done, platform))
        (OUT / "web" / f"viewer.{platform}.css").write_text(out, encoding="utf-8")
    (OUT / "web" / "viewer.css").unlink()
    if UNKNOWN: print("prefs without a default, taken as false:", sorted(UNKNOWN))
    # the browser's own version (support links carry it), next to its pdfjs.* defaults
    app = re.search(r"^Version=(.+)$", (APP / "application.ini").read_text(), re.M).group(1)
    (OUT / "prefs.json").write_text(json.dumps({"_appVersion": app, **{k[6:]: v for k, v in sorted(PREFS.items()) if k.startswith("pdfjs.")}}, indent=1))
    for old in sorted(set(re.findall(r'"resource://pdf\.js/[^"]*"', (OUT / "web" / "viewer.mjs").read_text(encoding="utf-8")))):
        patch(OUT / "web" / "viewer.mjs", old, 'globalThis.__hdfxBase + "' + old[len('"resource://pdf.js/'):])
    for old, new in HOOKS:
        patch(OUT / "build" / "pdf.mjs", old, new)
    ver = re.search(r'"(\d+\.\d+\.\d+)"', (OUT / "build" / "pdf.mjs").read_text(encoding="utf-8")).group(1)
    app = re.search(r"^Version=(.+)$", (APP / "application.ini").read_text(), re.M).group(1)
    (OUT / "VERSION").write_text(f"pdf.js {ver} from {APP.name} {app}\n")
    print(f"{n} files, pdf.js {ver} from {APP.name} {app}")


if __name__ == "__main__":
    main()

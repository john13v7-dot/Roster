"""Build the standalone index.html: inlines the jsPDF libraries so the page works offline.

    python web/build.py
"""
from pathlib import Path

here = Path(__file__).parent
src = (here / "app.src.html").read_text(encoding="utf-8")


def lib(name: str) -> str:
    code = (here / "vendor" / name).read_text(encoding="utf-8")
    code = "\n".join(l for l in code.splitlines() if "sourceMappingURL" not in l)
    return code.replace("</script", "<\\/script")


out = src.replace("/*JSPDF*/", lib("jspdf.umd.min.js")).replace("/*AUTOTABLE*/", lib("jspdf.plugin.autotable.min.js"))
(here.parent / "index.html").write_text(out, encoding="utf-8")
print("wrote index.html", len(out) // 1024, "KB")

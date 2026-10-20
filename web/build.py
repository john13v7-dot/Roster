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


# Variant for publishing as a claude.ai artifact: the host wraps the page in its own skeleton,
# so only the title, meta tag, style and body content are kept.
import re, sys
if len(sys.argv) > 1:
    m_title = re.search(r"<title>.*?</title>", out, re.S).group(0)
    m_meta = '<meta name="claude:viewport-fit-sides" content="cover">'
    m_style = re.search(r"<style>.*?</style>", out, re.S).group(0)
    m_body = re.search(r"<body>(.*)</body>", out, re.S).group(1)
    Path(sys.argv[1]).write_text("\n".join([m_title, m_meta, m_style, m_body]), encoding="utf-8")
    print("wrote artifact variant", sys.argv[1])

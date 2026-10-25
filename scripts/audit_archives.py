#!/usr/bin/env python3
"""Recursively inventory every original ZIP, including nested modules, without extraction."""
import ast
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TEXT = {".py", ".ts", ".tsx", ".js", ".json", ".html", ".css", ".md", ".yml", ".yaml", ".toml", ".txt"}


def inspect(content, archive, depth=0):
    if depth > 4:
        raise ValueError("Archive nesting limit exceeded")
    entries = []
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        if sum(x.file_size for x in z.infolist()) > 100_000_000:
            raise ValueError("Unexpected archive size")
        for item in z.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe archive path")
            if item.is_dir():
                continue
            raw = z.read(item)
            record = {"archive": archive, "path": str(path), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()}
            if path.suffix in TEXT:
                text = raw.decode("utf-8", errors="replace")
                record["lines"] = len(text.splitlines())
                if path.suffix == ".py":
                    tree = ast.parse(text)
                    record["pythonSymbols"] = [node.name for node in ast.walk(tree)
                                               if isinstance(node, (ast.FunctionDef, ast.ClassDef))]
            entries.append(record)
            if path.suffix.lower() == ".zip":
                entries.extend(inspect(raw, archive + "!" + str(path), depth + 1))
    return entries


def report():
    archives = []
    for path in sorted(ROOT.glob("*.zip")):
        raw = path.read_bytes()
        archives.append({"name": path.name, "sha256": hashlib.sha256(raw).hexdigest(),
                         "entries": inspect(raw, path.name)})
    return {"scope": "All original root ZIPs and nested ZIP entries. Inventory and Python AST scan; qualitative findings in SOURCE_AUDIT.md.", "archives": archives}


if __name__ == "__main__":
    result = report()
    path = ROOT / "docs/archive-inventory.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Audited {len(result['archives'])} root ZIPs; "
          f"{sum(len(x['entries']) for x in result['archives'])} file entries including nested archive")

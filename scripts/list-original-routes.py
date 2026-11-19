"""Inventory pinned original routes without loading application code or secrets."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "baseline/production/manifest.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
routes = []
for name, expected in manifest["files"].items():
    if not name.endswith(".py"):
        continue
    path = root / "baseline/production" / name
    if not path.exists():
        path = root / "legacy/pure" / name
    source = path.read_bytes()
    if hashlib.sha256(source).hexdigest() != expected["sha256"]:
        raise SystemExit("Pinned source mismatch: " + name)
    for function in ast.walk(ast.parse(source)):
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in function.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            method = decorator.func.attr
            if method not in ("get", "post", "put", "patch", "delete", "head", "api_route"):
                continue
            if not decorator.args or not isinstance(decorator.args[0], ast.Constant):
                raise SystemExit("Nonliteral route must be reviewed: " + name)
            methods = [method.upper()]
            if method == "api_route":
                methods = next(ast.literal_eval(k.value) for k in decorator.keywords if k.arg == "methods")
            for verb in methods:
                routes.append({"method": verb, "path": decorator.args[0].value, "source": name, "handler": function.name})
routes.sort(key=lambda row: (row["path"], row["method"]))
output = json.dumps({"release": manifest["release"], "routes": routes}, ensure_ascii=False, indent=2) + "\n"
target = root / "baseline/contracts/routes.json"
if args.check:
    if target.read_text() != output:
        raise SystemExit("Original API route inventory has changed")
else:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(output)
print(f"Verified {len(routes)} original method/path contracts")

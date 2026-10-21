#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
code_outline - High-Performance AST & Symbol Outline Engine for Autonomous Coding Agents
Provides rapid structural sight (classes, functions, signatures, docstrings, line ranges)
across Python, JavaScript, and TypeScript repositories without reading full file bodies,
reducing context window consumption by 85-95%.
"""

import os
import sys
import re
import ast
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional

# UTF-8 handling on Windows
if sys.platform == "win32":
    os.environ["PYTHONUTF8"] = "1"
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

IGNORE_DIRS = {
    ".git", ".svn", ".hg", "__pycache__", ".pytest_cache", ".mypy_cache",
    ".venv", "venv", "env", "node_modules", "dist", "build", ".next",
    ".nuxt", ".turbo", "coverage", ".idea", ".vscode", "tmp", "temp", "cache"
}

SUPPORTED_EXTENSIONS = {
    ".py", ".pyw", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
    ".json", ".yaml", ".yml", ".html", ".css", ".sql"
}


# ==============================================================================
# 1. Python AST Parser (Native, Zero-Dependency, Deterministic)
# ==============================================================================

def parse_python_ast(content: str, filepath: str) -> Dict[str, Any]:
    """Parse Python code using the native ast module and extract structural outline."""
    try:
        tree = ast.parse(content, filename=filepath)
    except SyntaxError as e:
        return {
            "error": f"SyntaxError at line {e.lineno}, col {e.offset}: {e.msg}",
            "classes": [],
            "functions": [],
            "globals": [],
        }

    classes = []
    functions = []
    globals_list = []

    def format_args(args_node: ast.arguments) -> str:
        parts = []
        for arg in args_node.args:
            arg_str = arg.arg
            if arg.annotation:
                arg_str += f": {ast.unparse(arg.annotation)}"
            parts.append(arg_str)
        if args_node.vararg:
            v_str = f"*{args_node.vararg.arg}"
            if args_node.vararg.annotation:
                v_str += f": {ast.unparse(args_node.vararg.annotation)}"
            parts.append(v_str)
        if args_node.kwarg:
            k_str = f"**{args_node.kwarg.arg}"
            if args_node.kwarg.annotation:
                k_str += f": {ast.unparse(args_node.kwarg.annotation)}"
            parts.append(k_str)
        return ", ".join(parts)

    def get_docstring_summary(node: ast.AST) -> str:
        doc = ast.get_docstring(node) or ""
        if doc:
            first_line = doc.strip().split("\n")[0].strip()
            return first_line[:120] + ("..." if len(first_line) > 120 else "")
        return ""

    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            bases = [ast.unparse(b) for b in node.bases]
            methods = []
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    is_async = isinstance(item, ast.AsyncFunctionDef)
                    ret_ann = f" -> {ast.unparse(item.returns)}" if item.returns else ""
                    methods.append({
                        "name": item.name,
                        "async": is_async,
                        "args": format_args(item.args),
                        "return_type": ret_ann,
                        "start_line": item.lineno,
                        "end_line": getattr(item, "end_lineno", item.lineno),
                        "doc": get_docstring_summary(item),
                    })
            classes.append({
                "name": node.name,
                "bases": bases,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "doc": get_docstring_summary(node),
                "methods": methods,
            })
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            is_async = isinstance(node, ast.AsyncFunctionDef)
            ret_ann = f" -> {ast.unparse(node.returns)}" if node.returns else ""
            functions.append({
                "name": node.name,
                "async": is_async,
                "args": format_args(node.args),
                "return_type": ret_ann,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "doc": get_docstring_summary(node),
            })
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    if target.id.isupper() or target.id.startswith("__"):
                        globals_list.append({
                            "name": target.id,
                            "line": node.lineno
                        })

    return {
        "classes": classes,
        "functions": functions,
        "globals": globals_list,
    }


# ==============================================================================
# 2. JavaScript & TypeScript Outline Parser (Fast Regex-Based)
# ==============================================================================

def parse_js_ts_outline(content: str) -> Dict[str, Any]:
    """Extract classes, interfaces, and functions from JS/TS source code."""
    classes = []
    functions = []
    interfaces = []

    re_class = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$.]+))?')
    re_iface = re.compile(r'^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_$]+)')
    re_fn = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*([A-Za-z0-9_$]+)?\s*\(([^)]*)\)')
    re_arrow = re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>')
    re_method = re.compile(r'^\s*(?:public|private|protected|static|async|\s)*([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{')

    lines = content.splitlines()
    brace_depth = 0
    current_class: Optional[Dict[str, Any]] = None
    class_brace_depth = 0

    for idx, line in enumerate(lines):
        lineno = idx + 1
        open_b = line.count("{")
        close_b = line.count("}")

        m_iface = re_iface.search(line)
        if m_iface and not line.strip().startswith("//"):
            interfaces.append({
                "name": m_iface.group(1),
                "line": lineno
            })

        m_cls = re_class.search(line)
        if m_cls and not line.strip().startswith("//"):
            cls_name = m_cls.group(1)
            base_cls = m_cls.group(2)
            current_class = {
                "name": cls_name,
                "bases": [base_cls] if base_cls else [],
                "start_line": lineno,
                "end_line": lineno,
                "methods": []
            }
            classes.append(current_class)
            class_brace_depth = brace_depth

        m_fn = re_fn.search(line)
        if m_fn and not line.strip().startswith("//"):
            fn_name = m_fn.group(1) or "anonymous"
            fn_args = m_fn.group(2).strip()
            is_async = "async" in line
            fn_obj = {
                "name": fn_name,
                "async": is_async,
                "args": fn_args,
                "return_type": "",
                "start_line": lineno,
                "end_line": lineno,
                "doc": "",
            }
            if current_class and brace_depth > class_brace_depth:
                current_class["methods"].append(fn_obj)
            else:
                functions.append(fn_obj)

        m_arr = re_arrow.search(line)
        if m_arr and not line.strip().startswith("//"):
            fn_name = m_arr.group(1)
            fn_args = m_arr.group(2).strip()
            is_async = "async" in line
            fn_obj = {
                "name": fn_name,
                "async": is_async,
                "args": fn_args,
                "return_type": "",
                "start_line": lineno,
                "end_line": lineno,
                "doc": "",
            }
            if not current_class:
                functions.append(fn_obj)

        if current_class and brace_depth == class_brace_depth + 1:
            m_meth = re_method.search(line)
            if m_meth and not line.strip().startswith(("//", "*", "if", "for", "while", "switch", "catch")):
                m_name = m_meth.group(1)
                m_args = m_meth.group(2).strip()
                if m_name not in ("constructor", "function", "return"):
                    current_class["methods"].append({
                        "name": m_name,
                        "async": "async" in line,
                        "args": m_args,
                        "return_type": "",
                        "start_line": lineno,
                        "end_line": lineno,
                        "doc": "",
                    })

        brace_depth += open_b - close_b

        if current_class and brace_depth <= class_brace_depth:
            current_class["end_line"] = lineno
            current_class = None

    return {
        "classes": classes,
        "functions": functions,
        "interfaces": interfaces,
    }


# ==============================================================================
# 3. Formatting & Output Helpers
# ==============================================================================

def get_file_outline_data(filepath: Path) -> Dict[str, Any]:
    """Parse file and return pure data dictionary."""
    content = filepath.read_text(encoding="utf-8", errors="ignore")
    lines = content.splitlines()
    total_lines = len(lines)
    size_kb = len(content.encode("utf-8")) / 1024
    ext = filepath.suffix.lower()

    res: Dict[str, Any] = {
        "file": str(filepath.resolve()),
        "name": filepath.name,
        "lines": total_lines,
        "size_kb": round(size_kb, 2),
        "extension": ext,
        "classes": [],
        "functions": [],
        "interfaces": [],
        "globals": []
    }

    if ext in (".py", ".pyw"):
        data = parse_python_ast(content, str(filepath))
        res.update(data)
    elif ext in (".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"):
        data = parse_js_ts_outline(content)
        res.update(data)

    return res


def format_file_outline(filepath: Path) -> str:
    """Read a file and produce a formatted structural outline."""
    try:
        data = get_file_outline_data(filepath)
    except Exception as e:
        return f"[ERROR] reading {filepath}: {e}"

    header = f"[FILE] {data['name']} ({data['lines']} lines, {data['size_kb']} KB) -> {data['file']}\n"
    out = [header]

    if "error" in data:
        return f"{header}  [SYNTAX-ERROR] {data['error']}\n"

    for cls in data.get("classes", []):
        bases_str = f" (extends {', '.join(cls['bases'])})" if cls.get("bases") else ""
        out.append(f"  [CLASS] class {cls['name']}{bases_str}  [L{cls['start_line']}-L{cls['end_line']}]")
        if cls.get("doc"):
            out.append(f"     \"\"\"{cls['doc']}\"\"\"")
        for m in cls.get("methods", []):
            prefix = "async def" if m.get("async") else "def"
            out.append(f"     [METHOD] {prefix} {m['name']}({m['args']}){m.get('return_type', '')}  [L{m['start_line']}-L{m['end_line']}]")
            if m.get("doc"):
                out.append(f"        \"\"\"{m['doc']}\"\"\"")

    for fn in data.get("functions", []):
        prefix = "async def" if fn.get("async") else "def"
        out.append(f"  [DEF] {prefix} {fn['name']}({fn['args']}){fn.get('return_type', '')}  [L{fn['start_line']}-L{fn['end_line']}]")
        if fn.get("doc"):
            out.append(f"     \"\"\"{fn['doc']}\"\"\"")

    if data.get("globals"):
        const_names = [g["name"] for g in data["globals"][:10]]
        out.append(f"  [CONST] {', '.join(const_names)}")

    if data.get("interfaces"):
        iface_names = [i["name"] for i in data["interfaces"][:10]]
        out.append(f"  [INTERFACE] {', '.join(iface_names)}")

    if not data.get("classes") and not data.get("functions") and not data.get("interfaces"):
        out.append(f"  (No top-level class or function declarations found. Total lines: {data['lines']})")

    return "\n".join(out)


def slice_lines(filepath: Path, start_line: int, end_line: int, as_json: bool = False) -> str:
    """Extract a specific line range with line numbers prefixed."""
    try:
        lines = filepath.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception as e:
        return f"[ERROR] reading {filepath}: {e}"

    total = len(lines)
    start = max(1, start_line)
    end = min(total, end_line)

    if as_json:
        return json.dumps({
            "file": str(filepath.resolve()),
            "start_line": start,
            "end_line": end,
            "total_lines": total,
            "lines": lines[start - 1:end]
        }, indent=2)

    header = f"[LINES] {filepath.name} [Lines {start} to {end} of {total}]:\n"
    out = [header]
    max_w = len(str(end))

    for i in range(start - 1, end):
        lnum = str(i + 1).rjust(max_w)
        out.append(f"{lnum} | {lines[i]}")

    return "\n".join(out)


def search_symbol(target_dir: Path, symbol: str, as_json: bool = False) -> str:
    """Scan directory and find exact declarations of a symbol."""
    results = []
    symbol_lower = symbol.lower()

    for root, dirs, files in os.walk(target_dir):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for f in files:
            p = Path(root) / f
            if p.suffix.lower() in (".py", ".js", ".ts", ".jsx", ".tsx"):
                try:
                    content = p.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue

                if p.suffix.lower() == ".py":
                    data = parse_python_ast(content, str(p))
                    for c in data.get("classes", []):
                        if symbol_lower in c["name"].lower():
                            results.append({
                                "type": "class",
                                "name": c["name"],
                                "file": str(p),
                                "start_line": c["start_line"],
                                "end_line": c["end_line"],
                                "signature": f"class {c['name']}"
                            })
                        for m in c.get("methods", []):
                            if symbol_lower in m["name"].lower():
                                results.append({
                                "type": "method",
                                "name": f"{c['name']}.{m['name']}",
                                "file": str(p),
                                "start_line": m["start_line"],
                                "end_line": m["end_line"],
                                "signature": f"def {m['name']}({m['args']})"
                            })
                    for fn in data.get("functions", []):
                        if symbol_lower in fn["name"].lower():
                            results.append({
                                "type": "function",
                                "name": fn["name"],
                                "file": str(p),
                                "start_line": fn["start_line"],
                                "end_line": fn["end_line"],
                                "signature": f"def {fn['name']}({fn['args']})"
                            })
                else:
                    data = parse_js_ts_outline(content)
                    for c in data.get("classes", []):
                        if symbol_lower in c["name"].lower():
                            results.append({
                                "type": "class",
                                "name": c["name"],
                                "file": str(p),
                                "start_line": c["start_line"],
                                "end_line": c["end_line"],
                                "signature": f"class {c['name']}"
                            })
                        for m in c.get("methods", []):
                            if symbol_lower in m["name"].lower():
                                results.append({
                                "type": "method",
                                "name": f"{c['name']}.{m['name']}",
                                "file": str(p),
                                "start_line": m["start_line"],
                                "end_line": m["end_line"],
                                "signature": m["name"]
                            })
                    for fn in data.get("functions", []):
                        if symbol_lower in fn["name"].lower():
                            results.append({
                                "type": "function",
                                "name": fn["name"],
                                "file": str(p),
                                "start_line": fn["start_line"],
                                "end_line": fn["end_line"],
                                "signature": f"function {fn['name']}"
                            })

    if as_json:
        return json.dumps({"symbol": symbol, "count": len(results), "matches": results}, indent=2)

    if not results:
        return f"[SEARCH] No symbol declaration matching '{symbol}' found in {target_dir}."

    lines = [f"[SEARCH] Declarations matching '{symbol}' ({len(results)} found):"]
    for r in results:
        lines.append(f"  [{r['type'].upper()}] {r['name']}  [L{r['start_line']}-L{r['end_line']}] -> {r['file']}")
    return "\n".join(lines)


def repo_summary(target_dir: Path, as_json: bool = False) -> str:
    """Produce a high-level architectural skeleton of a repository."""
    file_count = 0
    total_lines = 0
    tree_data: List[Dict[str, Any]] = []
    text_out = [f"[REPO-SKELETON] {target_dir.resolve()}\n"]

    for root, dirs, files in os.walk(target_dir):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        rel_root = Path(root).relative_to(target_dir)

        code_files = [f for f in files if Path(f).suffix.lower() in SUPPORTED_EXTENSIONS]
        if not code_files:
            continue

        indent = "  " * len(rel_root.parts)
        dir_display = str(rel_root).replace("\\", "/") if str(rel_root) != "." else "/"
        text_out.append(f"{indent}[DIR] {dir_display}/")

        dir_obj: Dict[str, Any] = {"dir": dir_display, "files": []}

        for f in code_files:
            file_count += 1
            p = Path(root) / f
            try:
                c = p.read_text(encoding="utf-8", errors="ignore")
                ln = len(c.splitlines())
                total_lines += ln
            except Exception:
                c = ""
                ln = 0

            symbols = []
            if p.suffix.lower() == ".py":
                d = parse_python_ast(c, str(p))
                symbols.extend([f"class {cl['name']}" for cl in d.get("classes", [])])
                symbols.extend([f"def {fn['name']}" for fn in d.get("functions", [])])
            elif p.suffix.lower() in (".js", ".ts", ".jsx", ".tsx"):
                d = parse_js_ts_outline(c)
                symbols.extend([f"class {cl['name']}" for cl in d.get("classes", [])])
                symbols.extend([f"fn {fn['name']}" for fn in d.get("functions", [])])

            sym_str = f"  ({', '.join(symbols[:3])}{'...' if len(symbols) > 3 else ''})" if symbols else ""
            text_out.append(f"{indent}   [FILE] {f} [{ln} lines]{sym_str}")
            dir_obj["files"].append({"file": f, "lines": ln, "symbols": symbols[:5]})

        tree_data.append(dir_obj)

    if as_json:
        return json.dumps({
            "root": str(target_dir.resolve()),
            "total_files": file_count,
            "total_lines": total_lines,
            "tree": tree_data
        }, indent=2)

    text_out.append(f"\n[SUMMARY] Total: {file_count} source files, {total_lines} total lines of code.")
    return "\n".join(text_out)


# ==============================================================================
# 4. Main CLI Controller
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="code_outline - High-Performance AST & Symbol Outline Engine for Coding Agents"
    )
    parser.add_argument("target", nargs="?", default=".", help="Target file or directory path")
    parser.add_argument("--repo", "-r", action="store_true", help="Generate repository architectural skeleton")
    parser.add_argument("--symbol", "-s", type=str, help="Search for a specific class or function declaration")
    parser.add_argument("--lines", "-l", type=str, help="Slice specific line range, e.g. 25-60")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    args = parser.parse_args()
    target_path = Path(args.target).resolve()

    if not target_path.exists():
        print(f"[ERROR] Target path does not exist: {target_path}", file=sys.stderr)
        sys.exit(1)

    # 1. Search symbol across directory
    if args.symbol:
        res = search_symbol(target_path if target_path.is_dir() else target_path.parent, args.symbol, as_json=args.json)
        print(res)
        return

    # 2. Slice lines of a specific file
    if args.lines:
        if not target_path.is_file():
            print("[ERROR] --lines requires a specific file target, not a directory.", file=sys.stderr)
            sys.exit(1)
        try:
            parts = args.lines.split("-")
            s = int(parts[0])
            e = int(parts[1]) if len(parts) > 1 else s + 30
        except ValueError:
            print("[ERROR] Invalid line range format. Use e.g. --lines 25-60", file=sys.stderr)
            sys.exit(1)
        print(slice_lines(target_path, s, e, as_json=args.json))
        return

    # 3. Repository skeleton mode
    if args.repo or (target_path.is_dir() and not args.symbol):
        print(repo_summary(target_path, as_json=args.json))
        return

    # 4. Single file outline mode
    if target_path.is_file():
        if args.json:
            print(json.dumps(get_file_outline_data(target_path), indent=2))
        else:
            print(format_file_outline(target_path))
        return


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
code_graph - Cross-File Reference, Call-Graph & Blast Radius Engine for Autonomous Coding Agents
Provides bi-directional call hierarchy (who calls X? what does X call?),
cross-file import mapping, and architectural blast-radius impact analysis
across Python, JavaScript, and TypeScript repositories without requiring external daemons.
"""

import os
import sys
import re
import ast
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Set, Tuple, Optional
from collections import defaultdict

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
    ".py", ".pyw", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"
}


# ==============================================================================
# 1. Project Symbol & Dependency Graph Representation
# ==============================================================================

class CodebaseGraph:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir.resolve()
        
        # Symbol index: short_name -> list of definitions
        # Each def: {"name": str, "fqn": str, "file": Path, "line": int, "type": "function"|"class"|"method", "container": str}
        self.symbols_by_name: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.symbols_by_fqn: Dict[str, Dict[str, Any]] = {}
        
        # File imports: file_path -> {local_alias: {"module": str, "orig_name": str}}
        self.file_imports: Dict[Path, Dict[str, Dict[str, str]]] = defaultdict(dict)
        
        # File-to-file dependency edges: source_file -> Set[target_file]
        self.file_dependencies: Dict[Path, Set[Path]] = defaultdict(set)
        # Reverse dependency edges (inbound): target_file -> Set[source_file]
        self.file_dependents: Dict[Path, Set[Path]] = defaultdict(set)
        
        # Call graph edges:
        # callers_of: callee_name -> list of {"caller": str, "caller_file": Path, "caller_line": int, "call_line": int}
        self.callers_of: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        # callees_of: caller_fqn -> list of {"callee": str, "line": int}
        self.callees_of: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        
        self.scanned_files = 0
        self.total_lines = 0

    def compute_module_fqn(self, file_path: Path) -> str:
        try:
            rel = file_path.relative_to(self.root_dir)
            parts = list(rel.with_suffix("").parts)
            if parts and parts[-1] == "__init__":
                parts.pop()
            return ".".join(parts)
        except ValueError:
            return file_path.stem

    # --------------------------------------------------------------------------
    # Python Indexing & Traversal
    # --------------------------------------------------------------------------
    def index_python_file(self, file_path: Path, content: str):
        try:
            tree = ast.parse(content, filename=str(file_path))
        except SyntaxError:
            return

        module_fqn = self.compute_module_fqn(file_path)

        # Pass 1: Collect definitions and imports
        for node in tree.body:
            # Direct imports: import foo.bar as fb
            if isinstance(node, ast.Import):
                for alias in node.names:
                    local = alias.asname or alias.name
                    self.file_imports[file_path][local] = {
                        "module": alias.name,
                        "orig_name": alias.name
                    }
            # From imports: from foo.bar import baz as bz
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                for alias in node.names:
                    local = alias.asname or alias.name
                    self.file_imports[file_path][local] = {
                        "module": mod,
                        "orig_name": alias.name
                    }

            # Top-level functions
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fqn = f"{module_fqn}.{node.name}" if module_fqn else node.name
                def_obj = {
                    "name": node.name,
                    "fqn": fqn,
                    "file": file_path,
                    "line": node.lineno,
                    "end_line": getattr(node, "end_lineno", node.lineno),
                    "type": "function",
                    "container": module_fqn
                }
                self.symbols_by_name[node.name].append(def_obj)
                self.symbols_by_fqn[fqn] = def_obj

            # Classes and methods
            elif isinstance(node, ast.ClassDef):
                cls_fqn = f"{module_fqn}.{node.name}" if module_fqn else node.name
                cls_obj = {
                    "name": node.name,
                    "fqn": cls_fqn,
                    "file": file_path,
                    "line": node.lineno,
                    "end_line": getattr(node, "end_lineno", node.lineno),
                    "type": "class",
                    "container": module_fqn
                }
                self.symbols_by_name[node.name].append(cls_obj)
                self.symbols_by_fqn[cls_fqn] = cls_obj

                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        m_fqn = f"{cls_fqn}.{item.name}"
                        m_obj = {
                            "name": item.name,
                            "fqn": m_fqn,
                            "file": file_path,
                            "line": item.lineno,
                            "end_line": getattr(item, "end_lineno", item.lineno),
                            "type": "method",
                            "container": cls_fqn
                        }
                        self.symbols_by_name[item.name].append(m_obj)
                        self.symbols_by_fqn[m_fqn] = m_obj

        # Pass 2: Extract function call relationships
        class CallVisitor(ast.NodeVisitor):
            def __init__(self, outer_graph, f_path, mod_name):
                self.graph = outer_graph
                self.file_path = f_path
                self.module_name = mod_name
                self.current_function = None
                self.current_func_line = 0

            def visit_FunctionDef(self, node):
                prev_fn = self.current_function
                prev_ln = self.current_func_line
                self.current_function = f"{self.module_name}.{node.name}" if self.module_name else node.name
                self.current_func_line = node.lineno
                self.generic_visit(node)
                self.current_function = prev_fn
                self.current_func_line = prev_ln

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_ClassDef(self, node):
                prev_mod = self.module_name
                self.module_name = f"{self.module_name}.{node.name}" if self.module_name else node.name
                self.generic_visit(node)
                self.module_name = prev_mod

            def visit_Call(self, node):
                callee_name = None
                if isinstance(node.func, ast.Name):
                    callee_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    callee_name = node.func.attr

                if callee_name:
                    caller = self.current_function or f"{self.module_name}:<module>"
                    # Record callee for current caller
                    self.graph.callees_of[caller].append({
                        "callee": callee_name,
                        "line": node.lineno
                    })
                    # Record caller of target symbol
                    self.graph.callers_of[callee_name].append({
                        "caller": caller,
                        "caller_file": self.file_path,
                        "caller_line": self.current_func_line,
                        "call_line": node.lineno
                    })

                self.generic_visit(node)

        visitor = CallVisitor(self, file_path, module_fqn)
        visitor.visit(tree)

    # --------------------------------------------------------------------------
    # JavaScript / TypeScript Indexing
    # --------------------------------------------------------------------------
    def index_js_file(self, file_path: Path, content: str):
        lines = content.splitlines()
        rel = file_path.relative_to(self.root_dir)
        module_fqn = str(rel.with_suffix("")).replace("\\", "/")

        re_import = re.compile(r'import\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s+from\s+[\'"]([^\'"]+)[\'"]')
        re_require = re.compile(r'(?:const|let|var)\s+(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s*=\s*require\([\'"]([^\'"]+)[\'"]')
        re_def = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)')
        re_class = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)')
        re_call = re.compile(r'\b([A-Za-z0-9_$]{2,})\s*\(')

        current_fn = None
        current_fn_line = 0

        for idx, line in enumerate(lines):
            lineno = idx + 1
            line_str = line.strip()
            if line_str.startswith("//"):
                continue

            # Imports
            m_imp = re_import.search(line) or re_require.search(line)
            if m_imp:
                named = m_imp.group(1)
                default_name = m_imp.group(2)
                src = m_imp.group(3)
                if named:
                    for item in named.split(","):
                        it = item.strip()
                        if " as " in it:
                            orig, alias = it.split(" as ")
                            self.file_imports[file_path][alias.strip()] = {"module": src, "orig_name": orig.strip()}
                        elif it:
                            self.file_imports[file_path][it] = {"module": src, "orig_name": it}
                elif default_name:
                    self.file_imports[file_path][default_name] = {"module": src, "orig_name": "default"}

            # Function / Class definitions
            m_fn = re_def.search(line)
            if m_fn:
                name = m_fn.group(1)
                fqn = f"{module_fqn}.{name}"
                def_obj = {
                    "name": name,
                    "fqn": fqn,
                    "file": file_path,
                    "line": lineno,
                    "end_line": lineno,
                    "type": "function",
                    "container": module_fqn
                }
                self.symbols_by_name[name].append(def_obj)
                self.symbols_by_fqn[fqn] = def_obj
                current_fn = fqn
                current_fn_line = lineno

            m_cls = re_class.search(line)
            if m_cls:
                name = m_cls.group(1)
                fqn = f"{module_fqn}.{name}"
                def_obj = {
                    "name": name,
                    "fqn": fqn,
                    "file": file_path,
                    "line": lineno,
                    "end_line": lineno,
                    "type": "class",
                    "container": module_fqn
                }
                self.symbols_by_name[name].append(def_obj)
                self.symbols_by_fqn[fqn] = def_obj

            # Calls
            for m_call in re_call.finditer(line):
                callee_name = m_call.group(1)
                if callee_name not in ("if", "for", "while", "switch", "catch", "function", "return"):
                    caller = current_fn or f"{module_fqn}:<top>"
                    self.callees_of[caller].append({"callee": callee_name, "line": lineno})
                    self.callers_of[callee_name].append({
                        "caller": caller,
                        "caller_file": file_path,
                        "caller_line": current_fn_line,
                        "call_line": lineno
                    })

    # --------------------------------------------------------------------------
    # Full Codebase Scan & Graph Edge Resolution
    # --------------------------------------------------------------------------
    def scan_project(self):
        all_code_files = []
        for root, dirs, files in os.walk(self.root_dir):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            for f in files:
                p = Path(root) / f
                if p.suffix.lower() in SUPPORTED_EXTENSIONS:
                    all_code_files.append(p)

        self.scanned_files = len(all_code_files)

        # Index all files
        for p in all_code_files:
            try:
                content = p.read_text(encoding="utf-8", errors="ignore")
                self.total_lines += len(content.splitlines())
            except Exception:
                continue

            if p.suffix.lower() in (".py", ".pyw"):
                self.index_python_file(p, content)
            elif p.suffix.lower() in (".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"):
                self.index_js_file(p, content)

        # Resolve File -> File Dependencies
        # A file A depends on file B if:
        # 1. file A imports module B directly
        # 2. file A calls a symbol defined uniquely or declared in file B
        for f_path, imports in self.file_imports.items():
            for alias, info in imports.items():
                mod = info["module"]
                # Try matching Python module to local file
                rel_mod_path = mod.replace(".", "/")
                cand_py = (self.root_dir / f"{rel_mod_path}.py")
                cand_init = (self.root_dir / rel_mod_path / "__init__.py")
                cand_js = (f_path.parent / f"{mod}.js")
                cand_ts = (f_path.parent / f"{mod}.ts")
                
                for cand in (cand_py, cand_init, cand_js, cand_ts):
                    if cand.is_file():
                        self.file_dependencies[f_path].add(cand.resolve())
                        self.file_dependents[cand.resolve()].add(f_path.resolve())

        # Also connect files based on unique symbol calls
        for callee_name, callers in self.callers_of.items():
            defs = self.symbols_by_name.get(callee_name, [])
            if len(defs) == 1:
                target_file = defs[0]["file"].resolve()
                for c in callers:
                    src_file = c["caller_file"].resolve()
                    if src_file != target_file:
                        self.file_dependencies[src_file].add(target_file)
                        self.file_dependents[target_file].add(src_file)


# ==============================================================================
# 2. Query Controllers & Presentation
# ==============================================================================

def query_callers(graph: CodebaseGraph, symbol: str, as_json: bool = False) -> str:
    """Find all call sites of a symbol across the entire project."""
    graph.scan_project()
    matches = graph.callers_of.get(symbol, [])

    # If no exact match, search case-insensitively
    if not matches:
        for k in graph.callers_of.keys():
            if k.lower() == symbol.lower():
                matches = graph.callers_of[k]
                symbol = k
                break

    defs = graph.symbols_by_name.get(symbol, [])

    if as_json:
        return json.dumps({
            "symbol": symbol,
            "definitions": [{
                "fqn": d["fqn"],
                "file": str(d["file"]),
                "line": d["line"],
                "type": d["type"]
            } for d in defs],
            "total_call_sites": len(matches),
            "callers": [{
                "caller": m["caller"],
                "file": str(m["caller_file"]),
                "call_line": m["call_line"]
            } for m in matches]
        }, indent=2)

    out = [f"[CALLERS] Inbound calls to symbol '{symbol}' ({len(matches)} call sites found):"]
    if defs:
        out.append("  Declared in:")
        for d in defs:
            out.append(f"    - [{d['type'].upper()}] {d['fqn']} [Line {d['line']}] -> {d['file']}")
    else:
        out.append("  (Symbol declaration not indexed locally; could be dynamic or external)")

    if not matches:
        out.append(f"  [RESULT] No direct calls to '{symbol}' detected in the codebase.")
        return "\n".join(out)

    out.append("\n  Call sites:")
    by_file = defaultdict(list)
    for m in matches:
        by_file[m["caller_file"]].append(m)

    for f_path, c_list in by_file.items():
        rel = f_path.relative_to(graph.root_dir)
        out.append(f"    File: {rel} ({len(c_list)} calls)")
        for c in c_list:
            out.append(f"      L{c['call_line']} | inside {c['caller']}()")

    return "\n".join(out)


def query_callees(graph: CodebaseGraph, symbol: str, as_json: bool = False) -> str:
    """Find all symbols called or consumed by a function or class."""
    graph.scan_project()
    
    # Try finding caller by FQN or short name
    matched_caller = None
    callees = []
    
    for caller_fqn, c_list in graph.callees_of.items():
        if caller_fqn == symbol or caller_fqn.endswith(f".{symbol}"):
            matched_caller = caller_fqn
            callees = c_list
            break

    if as_json:
        return json.dumps({
            "caller": matched_caller or symbol,
            "total_calls": len(callees),
            "dependencies": callees
        }, indent=2)

    out = [f"[CALLEES] Outbound calls from '{matched_caller or symbol}':"]
    if not callees:
        out.append(f"  [RESULT] No outbound function calls recorded for '{symbol}'.")
        return "\n".join(out)

    out.append(f"  Total outbound calls: {len(callees)}")
    for c in callees:
        defs = graph.symbols_by_name.get(c["callee"], [])
        def_loc = f" -> {defs[0]['file'].name}:L{defs[0]['line']}" if defs else " (external/builtin)"
        out.append(f"    L{c['line']} | calls {c['callee']}{def_loc}")

    return "\n".join(out)


def query_impact(graph: CodebaseGraph, target_file_str: str, as_json: bool = False) -> str:
    """Analyze the Blast Radius and downstream impact if target_file is modified."""
    graph.scan_project()
    target_path = Path(target_file_str).resolve()

    if not target_path.exists():
        return f"[ERROR] Target file does not exist: {target_path}"

    dependents = graph.file_dependents.get(target_path, set())
    
    # Second-order dependents (files that depend on the files that depend on target)
    second_order: Set[Path] = set()
    for d in dependents:
        for d2 in graph.file_dependents.get(d, set()):
            if d2 != target_path and d2 not in dependents:
                second_order.add(d2)

    # Exposed symbols in target file
    exposed_symbols = [
        s for s in graph.symbols_by_fqn.values()
        if s["file"].resolve() == target_path
    ]

    # Inbound calls to symbols in this file
    calls_affected = []
    for s in exposed_symbols:
        defs = graph.symbols_by_name.get(s["name"], [])
        for c in graph.callers_of.get(s["name"], []):
            if c["caller_file"].resolve() != target_path:
                # If symbol is defined in multiple files, only count cross-file call if caller imports target file
                if len(defs) == 1 or c["caller_file"].resolve() in dependents:
                    calls_affected.append({
                        "symbol": s["name"],
                        "caller_file": str(c["caller_file"]),
                        "line": c["call_line"]
                    })

    if as_json:
        return json.dumps({
            "target_file": str(target_path),
            "direct_dependents_count": len(dependents),
            "direct_dependents": [str(p) for p in dependents],
            "second_order_dependents_count": len(second_order),
            "second_order_dependents": [str(p) for p in second_order],
            "exposed_symbols_count": len(exposed_symbols),
            "cross_file_calls_affected_count": len(calls_affected),
            "cross_file_calls_affected": calls_affected
        }, indent=2)

    rel_name = target_path.relative_to(graph.root_dir) if target_path.is_relative_to(graph.root_dir) else target_path.name
    out = [f"[IMPACT ANALYSIS] Blast Radius report for: {rel_name}"]
    out.append(f"  Exposed declarations: {len(exposed_symbols)} symbols (classes & functions)")
    out.append(f"  Directly coupled files: {len(dependents)}")
    out.append(f"  Indirectly affected files: {len(second_order)}")
    out.append(f"  Cross-file call sites at risk: {len(calls_affected)}")

    if dependents:
        out.append("\n  Direct Dependent Files (Must verify if breaking changes occur):")
        for d in dependents:
            try:
                r = d.relative_to(graph.root_dir)
            except ValueError:
                r = d.name
            out.append(f"    - {r}")

    if calls_affected:
        out.append("\n  Key Cross-File Call Sites:")
        for ca in calls_affected[:10]:
            p = Path(ca["caller_file"]).name
            out.append(f"    - calls {ca['symbol']}() in {p}:L{ca['line']}")
        if len(calls_affected) > 10:
            out.append(f"    ... and {len(calls_affected) - 10} more call sites.")

    if not dependents and not calls_affected:
        out.append("\n  [VERDICT] Low Blast Radius: This module is an isolated component or leaf node.")
    else:
        out.append(f"\n  [VERDICT] Moderate/High Blast Radius: Modifications require testing {len(dependents)} dependent modules.")

    return "\n".join(out)


def query_matrix(graph: CodebaseGraph, as_json: bool = False) -> str:
    """Print the complete architectural dependency matrix across all modules."""
    graph.scan_project()

    all_deps = []
    for src, targets in graph.file_dependencies.items():
        if targets:
            try:
                rel_src = str(src.relative_to(graph.root_dir))
            except ValueError:
                rel_src = src.name
            rel_targets = []
            for t in targets:
                try:
                    rel_targets.append(str(t.relative_to(graph.root_dir)))
                except ValueError:
                    rel_targets.append(t.name)
            all_deps.append({"file": rel_src, "depends_on": sorted(rel_targets)})

    all_deps.sort(key=lambda x: len(x["depends_on"]), reverse=True)

    if as_json:
        return json.dumps({
            "root": str(graph.root_dir),
            "total_modules": graph.scanned_files,
            "total_lines": graph.total_lines,
            "dependency_matrix": all_deps
        }, indent=2)

    out = [f"[DEPENDENCY MATRIX] Project Architecture ({graph.scanned_files} files, {graph.total_lines} lines):\n"]
    if not all_deps:
        out.append("  (No inter-file dependencies detected; single-file or loosely coupled project)")
        return "\n".join(out)

    for item in all_deps:
        out.append(f"  [MODULE] {item['file']} ({len(item['depends_on'])} dependencies)")
        for t in item["depends_on"]:
            out.append(f"    --> {t}")

    return "\n".join(out)


# ==============================================================================
# 3. Main Command-Line Interface
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="code_graph - Cross-File Reference, Call-Graph & Blast Radius Engine for Coding Agents"
    )
    parser.add_argument("target", nargs="?", default=".", help="Target project directory or file")
    parser.add_argument("--callers", "-c", type=str, help="Find all callers of a symbol across the project")
    parser.add_argument("--callees", "-e", type=str, help="Find all functions called by a function/class")
    parser.add_argument("--impact", "-i", type=str, help="Calculate the Blast Radius of modifying a file")
    parser.add_argument("--matrix", "-m", action="store_true", help="Print the architectural dependency matrix")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    args = parser.parse_args()
    target_path = Path(args.target).resolve()
    
    root_dir = target_path if target_path.is_dir() else target_path.parent
    graph = CodebaseGraph(root_dir)

    # 1. Query Callers
    if args.callers:
        print(query_callers(graph, args.callers, as_json=args.json))
        return

    # 2. Query Callees
    if args.callees:
        print(query_callees(graph, args.callees, as_json=args.json))
        return

    # 3. Query Impact / Blast Radius
    if args.impact:
        print(query_impact(graph, args.impact, as_json=args.json))
        return

    # 4. Dependency Matrix
    if args.matrix:
        print(query_matrix(graph, as_json=args.json))
        return

    # Default action when target is a file
    if target_path.is_file():
        print(query_impact(graph, str(target_path), as_json=args.json))
        return

    # Default action when target is a directory: matrix
    print(query_matrix(graph, as_json=args.json))


if __name__ == "__main__":
    main()

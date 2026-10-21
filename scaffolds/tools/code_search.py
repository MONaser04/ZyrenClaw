#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
code_search - Semantic Code Retrieval & Cross-Encoder Reranking Engine for Autonomous Agents
Powered by NVIDIA Nemotron-3.5-Embed-8B and Nemotron-3.5-Rerank-8B with AST-aware chunking
and local incremental SQLite caching.
"""

import os
import sys
import re
import ast
import json
import math
import hashlib
import sqlite3
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

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

CACHE_DIR = Path(os.environ.get("USERPROFILE", ".")) / ".openclaw" / "cache"
CACHE_DB_PATH = CACHE_DIR / "code_search_cache.db"

EMBED_URL = "https://integrate.api.nvidia.com/v1/embeddings"
RERANK_URL = "https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking"

EMBED_MODEL = "nvidia/nemotron-3.5-embed-8b"
RERANK_MODEL = "nvidia/nemotron-3.5-rerank-8b"


# ==============================================================================
# 1. NVIDIA API Credential & Calling Helpers
# ==============================================================================

def get_nvidia_api_key() -> str:
    """Retrieve NVIDIA API key from environment or Windows Registry fallback."""
    key = os.environ.get("NVIDIA_API_KEY")
    if key and key.strip():
        return key.strip()

    if sys.platform == "win32":
        try:
            import winreg
            for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                sub = r"Environment" if root == winreg.HKEY_CURRENT_USER else r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
                try:
                    with winreg.OpenKey(root, sub) as reg:
                        val, _ = winreg.QueryValueEx(reg, "NVIDIA_API_KEY")
                        if val and str(val).strip():
                            return str(val).strip()
                except Exception:
                    pass
        except Exception:
            pass

    return ""


def call_nvidia_embeddings(texts: List[str], input_type: str = "passage") -> List[List[float]]:
    """Generate dense embeddings using NVIDIA Nemotron 3.5 Embed 8B."""
    api_key = get_nvidia_api_key()
    if not api_key:
        raise ValueError("NVIDIA_API_KEY environment variable is not configured.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    # Batch in groups of 32 to stay well within payload limits
    batch_size = 32
    all_embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        payload = {
            "model": EMBED_MODEL,
            "input": batch,
            "input_type": input_type,
            "encoding_format": "float",
            "truncate": "END"
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(EMBED_URL, data=data, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                for item in res.get("data", []):
                    all_embeddings.append(item["embedding"])
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"NVIDIA Embedding API Error ({e.code}): {err_body}")

    return all_embeddings


def call_nvidia_rerank(query: str, passages: List[str]) -> List[Tuple[int, float]]:
    """Rerank passages using NVIDIA Nemotron 3.5 Rerank 8B. Returns list of (original_index, logit)."""
    if not passages:
        return []

    api_key = get_nvidia_api_key()
    if not api_key:
        raise ValueError("NVIDIA_API_KEY environment variable is not configured.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    payload = {
        "model": RERANK_MODEL,
        "query": {"text": query},
        "passages": [{"text": p} for p in passages],
        "truncate": "END"
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(RERANK_URL, data=data, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            rankings = res.get("rankings", [])
            # rankings: [{"index": int, "logit": float}, ...]
            return [(r["index"], float(r.get("logit", 0.0))) for r in rankings]
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"NVIDIA Rerank API Error ({e.code}): {err_body}")


# ==============================================================================
# 2. AST-Aware Code Chunking Engine
# ==============================================================================

def chunk_file_ast(file_path: Path, root_dir: Path) -> List[Dict[str, Any]]:
    """Chunk a source code file into meaningful semantic units (classes, functions, modules)."""
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    lines = content.splitlines()
    total_lines = len(lines)
    if total_lines == 0:
        return []

    try:
        rel_path = file_path.relative_to(root_dir).as_posix()
    except ValueError:
        rel_path = file_path.name

    ext = file_path.suffix.lower()
    chunks: List[Dict[str, Any]] = []

    # 1. Python AST parsing
    if ext in (".py", ".pyw"):
        try:
            tree = ast.parse(content, filename=str(file_path))
            parsed = True
        except SyntaxError:
            parsed = False

        if parsed:
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    s_line = node.lineno
                    e_line = getattr(node, "end_lineno", s_line)
                    code_block = "\n".join(lines[s_line - 1:e_line])
                    chunks.append({
                        "file": str(file_path.resolve()),
                        "rel_file": rel_path,
                        "symbol": node.name,
                        "type": "function",
                        "start_line": s_line,
                        "end_line": e_line,
                        "content": code_block,
                        "header_text": f"File: {rel_path} | Function: {node.name}() [L{s_line}-L{e_line}]\n{code_block}"
                    })

                elif isinstance(node, ast.ClassDef):
                    s_line = node.lineno
                    e_line = getattr(node, "end_lineno", s_line)
                    # For class, extract class overview + docstring
                    doc = ast.get_docstring(node) or ""
                    method_names = [m.name for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
                    class_summary = f"class {node.name}: {doc}\nMethods: {', '.join(method_names[:10])}"
                    chunks.append({
                        "file": str(file_path.resolve()),
                        "rel_file": rel_path,
                        "symbol": node.name,
                        "type": "class",
                        "start_line": s_line,
                        "end_line": e_line,
                        "content": class_summary,
                        "header_text": f"File: {rel_path} | Class: {node.name} [L{s_line}-L{e_line}]\n{class_summary}"
                    })
                    # Also chunk individual methods if they are substantial
                    for item in node.body:
                        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            ms = item.lineno
                            me = getattr(item, "end_lineno", ms)
                            m_code = "\n".join(lines[ms - 1:me])
                            chunks.append({
                                "file": str(file_path.resolve()),
                                "rel_file": rel_path,
                                "symbol": f"{node.name}.{item.name}",
                                "type": "method",
                                "start_line": ms,
                                "end_line": me,
                                "content": m_code,
                                "header_text": f"File: {rel_path} | Method: {node.name}.{item.name}() [L{ms}-L{me}]\n{m_code}"
                            })

    # 2. JavaScript / TypeScript Regex chunking
    elif ext in (".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"):
        re_fn = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)')
        re_arr = re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>')
        re_cls = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)')

        for idx, line in enumerate(lines):
            lineno = idx + 1
            m = re_fn.search(line) or re_arr.search(line) or re_cls.search(line)
            if m and not line.strip().startswith("//"):
                sym_name = m.group(1)
                e_line = min(total_lines, lineno + 40)
                code_block = "\n".join(lines[lineno - 1:e_line])
                chunks.append({
                    "file": str(file_path.resolve()),
                    "rel_file": rel_path,
                    "symbol": sym_name,
                    "type": "symbol",
                    "start_line": lineno,
                    "end_line": e_line,
                    "content": code_block,
                    "header_text": f"File: {rel_path} | Symbol: {sym_name} [L{lineno}-L{e_line}]\n{code_block}"
                })

    # 3. Fallback for files without matched AST functions or small files
    if not chunks:
        step = 60
        for s in range(1, total_lines + 1, step):
            e = min(total_lines, s + step - 1)
            code_block = "\n".join(lines[s - 1:e])
            chunks.append({
                "file": str(file_path.resolve()),
                "rel_file": rel_path,
                "symbol": f"block_{s}",
                "type": "block",
                "start_line": s,
                "end_line": e,
                "content": code_block,
                "header_text": f"File: {rel_path} [Lines {s}-{e}]\n{code_block}"
            })

    return chunks


# ==============================================================================
# 3. Local SQLite Cache & Vector Store
# ==============================================================================

class LocalVectorCache:
    def __init__(self, db_path: Path = CACHE_DB_PATH):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.init_tables()

    def init_tables(self):
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS file_registry (
                    file_path TEXT PRIMARY KEY,
                    sha256 TEXT,
                    mtime REAL,
                    chunk_count INT
                )
            """)
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS chunk_embeddings (
                    chunk_id TEXT PRIMARY KEY,
                    file_path TEXT,
                    rel_file TEXT,
                    symbol TEXT,
                    chunk_type TEXT,
                    start_line INT,
                    end_line INT,
                    content TEXT,
                    header_text TEXT,
                    embedding_json TEXT
                )
            """)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_chunk_file ON chunk_embeddings(file_path)")

    def get_file_hash(self, file_path: Path) -> str:
        h = hashlib.sha256()
        try:
            h.update(file_path.read_bytes())
            return h.hexdigest()
        except Exception:
            return ""

    def is_file_fresh(self, file_path: Path) -> bool:
        cur = self.conn.cursor()
        cur.execute("SELECT sha256 FROM file_registry WHERE file_path = ?", (str(file_path.resolve()),))
        row = cur.fetchone()
        if not row:
            return False
        curr_hash = self.get_file_hash(file_path)
        return row[0] == curr_hash

    def update_file_chunks(self, file_path: Path, chunks: List[Dict[str, Any]], embeddings: List[List[float]]):
        f_str = str(file_path.resolve())
        curr_hash = self.get_file_hash(file_path)
        mtime = file_path.stat().st_mtime

        with self.conn:
            self.conn.execute("DELETE FROM chunk_embeddings WHERE file_path = ?", (f_str,))
            for idx, (chunk, emb) in enumerate(zip(chunks, embeddings)):
                cid = f"{f_str}::{chunk['symbol']}::{chunk['start_line']}"
                self.conn.execute("""
                    INSERT OR REPLACE INTO chunk_embeddings 
                    (chunk_id, file_path, rel_file, symbol, chunk_type, start_line, end_line, content, header_text, embedding_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    cid, f_str, chunk["rel_file"], chunk["symbol"], chunk["type"],
                    chunk["start_line"], chunk["end_line"], chunk["content"],
                    chunk["header_text"], json.dumps(emb)
                ))
            self.conn.execute("""
                INSERT OR REPLACE INTO file_registry (file_path, sha256, mtime, chunk_count)
                VALUES (?, ?, ?, ?)
            """, (f_str, curr_hash, mtime, len(chunks)))

    def load_project_embeddings(self, project_root: Path) -> List[Dict[str, Any]]:
        root_str = str(project_root.resolve())
        cur = self.conn.cursor()
        cur.execute("""
            SELECT chunk_id, file_path, rel_file, symbol, start_line, end_line, content, header_text, embedding_json
            FROM chunk_embeddings
            WHERE file_path LIKE ?
        """, (f"{root_str}%",))
        rows = cur.fetchall()

        results = []
        for r in rows:
            results.append({
                "chunk_id": r[0],
                "file_path": r[1],
                "rel_file": r[2],
                "symbol": r[3],
                "start_line": r[4],
                "end_line": r[5],
                "content": r[6],
                "header_text": r[7],
                "embedding": json.loads(r[8])
            })
        return results

    def clear_project_cache(self, project_root: Path):
        root_str = str(project_root.resolve())
        with self.conn:
            self.conn.execute("DELETE FROM chunk_embeddings WHERE file_path LIKE ?", (f"{root_str}%",))
            self.conn.execute("DELETE FROM file_registry WHERE file_path LIKE ?", (f"{root_str}%",))


# ==============================================================================
# 4. Search Pipeline (Cosine + Nemotron Rerank)
# ==============================================================================

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    dot = 0.0
    norm1 = 0.0
    norm2 = 0.0
    for a, b in zip(v1, v2):
        dot += a * b
        norm1 += a * a
        norm2 += b * b
    if norm1 <= 0.0 or norm2 <= 0.0:
        return 0.0
    return dot / (math.sqrt(norm1) * math.sqrt(norm2))


def index_codebase(root_dir: Path, cache: LocalVectorCache, force_reindex: bool = False):
    """Scan and index all code files in the project."""
    if force_reindex:
        cache.clear_project_cache(root_dir)

    all_files = []
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for f in files:
            p = Path(root) / f
            if p.suffix.lower() in SUPPORTED_EXTENSIONS:
                all_files.append(p)

    stale_files = [p for p in all_files if not cache.is_file_fresh(p)]

    if stale_files:
        for p in stale_files:
            chunks = chunk_file_ast(p, root_dir)
            if not chunks:
                continue
            texts = [c["header_text"] for c in chunks]
            try:
                embeddings = call_nvidia_embeddings(texts, input_type="passage")
                cache.update_file_chunks(p, chunks, embeddings)
            except Exception as e:
                print(f"[WARN] Failed to index {p.name}: {e}", file=sys.stderr)


def perform_search(
    root_dir: Path,
    query: str,
    top_k: int = 3,
    force_reindex: bool = False,
    as_json: bool = False
) -> str:
    """Execute Two-Stage Dense Retrieval + Reranking."""
    cache = LocalVectorCache()
    index_codebase(root_dir, cache, force_reindex=force_reindex)

    cached_chunks = cache.load_project_embeddings(root_dir)
    if not cached_chunks:
        msg = f"[SEARCH] No indexed code chunks found in: {root_dir.resolve()}"
        return json.dumps({"error": msg}) if as_json else msg

    # Step 1: Query embedding
    try:
        q_emb = call_nvidia_embeddings([query], input_type="query")[0]
    except Exception as e:
        msg = f"[ERROR] Failed to embed query via NVIDIA API: {e}"
        return json.dumps({"error": msg}) if as_json else msg

    # Step 2: Dense retrieval (Top 15 candidates by cosine similarity)
    scored_candidates = []
    for c in cached_chunks:
        sim = cosine_similarity(q_emb, c["embedding"])
        scored_candidates.append((sim, c))

    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    candidate_pool = scored_candidates[:15]

    if not candidate_pool:
        msg = f"[SEARCH] No matches found for query: '{query}'"
        return json.dumps({"query": query, "results": []}) if as_json else msg

    # Step 3: Precision Reranking via NVIDIA Nemotron-3.5-Rerank-8B
    passages = [c["header_text"] for _, c in candidate_pool]
    try:
        rank_scores = call_nvidia_rerank(query, passages)
        # Sort candidate pool based on reranker logit
        reranked_results = []
        for orig_idx, logit in rank_scores:
            if orig_idx < len(candidate_pool):
                chunk = candidate_pool[orig_idx][1]
                reranked_results.append({
                    "score": round(logit, 4),
                    "file": chunk["file_path"],
                    "rel_file": chunk["rel_file"],
                    "symbol": chunk["symbol"],
                    "start_line": chunk["start_line"],
                    "end_line": chunk["end_line"],
                    "content": chunk["content"]
                })
        reranked_results.sort(key=lambda x: x["score"], reverse=True)
    except Exception as e:
        # Fallback to cosine scores if rerank API encounters transient errors
        reranked_results = []
        for sim, chunk in candidate_pool:
            reranked_results.append({
                "score": round(sim, 4),
                "file": chunk["file_path"],
                "rel_file": chunk["rel_file"],
                "symbol": chunk["symbol"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"],
                "content": chunk["content"]
            })

    final_results = reranked_results[:top_k]

    if as_json:
        return json.dumps({
            "query": query,
            "engine": f"{EMBED_MODEL} + {RERANK_MODEL}",
            "top_k": len(final_results),
            "results": final_results
        }, indent=2)

    out = [f"[SEARCH RESULTS] Query: '{query}' (Top {len(final_results)} matches via {RERANK_MODEL}):\n"]
    for idx, r in enumerate(final_results):
        rank = idx + 1
        lines_preview = r["content"].splitlines()[:5]
        preview_text = "\n     ".join(lines_preview)
        if len(r["content"].splitlines()) > 5:
            preview_text += "\n     ..."
        out.append(f"  {rank}. [SCORE: {r['score']}] File: {r['rel_file']} [Lines {r['start_line']}-{r['end_line']}] ({r['symbol']})")
        out.append(f"     Code Snippet:\n     {preview_text}\n")

    return "\n".join(out)


# ==============================================================================
# 5. Main CLI Controller
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="code_search - Semantic Code Retrieval & Reranking Engine for Autonomous Agents"
    )
    parser.add_argument("query", nargs="?", default="", help="Natural language search query")
    parser.add_argument("--target", "-t", default=".", help="Target project root directory")
    parser.add_argument("--top", "-k", type=int, default=3, help="Number of top reranked results to return")
    parser.add_argument("--reindex", "-r", action="store_true", help="Force rebuild the local vector cache")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    args = parser.parse_args()
    root_dir = Path(args.target).resolve()

    if args.reindex and not args.query:
        cache = LocalVectorCache()
        print(f"[INDEX] Rebuilding vector index for {root_dir}...")
        index_codebase(root_dir, cache, force_reindex=True)
        print("[INDEX] Completed successfully.")
        return

    if not args.query:
        parser.print_help()
        sys.exit(0)

    print(perform_search(
        root_dir=root_dir,
        query=args.query,
        top_k=args.top,
        force_reindex=args.reindex,
        as_json=args.json
    ))


if __name__ == "__main__":
    main()

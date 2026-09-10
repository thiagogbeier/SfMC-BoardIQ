#!/usr/bin/env python3
"""
SfMC Client Boards - local API + static server.

Stdlib only. Serves the board UI from ./app and a small JSON API backed by
./data/store.json. Every mutating request writes a timestamped backup first.

Run:  python server.py [--port 8790] [--no-browser]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
import webbrowser
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")
DATA_DIR = os.path.join(ROOT, "data")
STORE = os.path.join(DATA_DIR, "store.json")
PROPOSALS = os.path.join(DATA_DIR, "proposals.json")
BACKUPS = os.path.join(DATA_DIR, "backups")
INSTANCE_FILE = os.path.join(ROOT, "instance.json")
MAX_BACKUPS = 40

_lock = threading.Lock()

# Per-deployment branding / behaviour. Everything that differs between the
# production board and the demo board lives here, so server.py, app/ and the
# PowerShell scripts stay byte-identical across instances.
DEFAULT_INSTANCE = {
    "name": "SfMC Client Boards",
    "logo": "SfMC",
    "title": "Client Boards",
    "port": 8790,
    "taskName": "SfMC Client Boards",
    "pinnedBottom": ["sfmc-team", "manager-1-1"],
    "adoEnabled": True,
    "demo": False,
}


def load_instance() -> dict:
    inst = dict(DEFAULT_INSTANCE)
    try:
        with open(INSTANCE_FILE, "r", encoding="utf-8") as fh:
            inst.update(json.load(fh) or {})
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        pass
    return inst


INSTANCE = load_instance()

DEFAULT_STORE = {
    "version": 1,
    "settings": {
        "columns": ["New", "Active", "In Progress", "Resolved", "Closed"],
        "types": ["User Story", "Task", "Bug", "Risk", "Meeting", "Milestone"],
        "priorities": [1, 2, 3, 4],
        "valueAreas": ["Business", "Architectural"],
        "riskLevels": ["1 - High", "2 - Medium", "3 - Low"],
        "escalationTargets": ["PM", "PG", "CSAM", "Resourcing", "Manager"],
        "escalationStatuses": ["submitted", "on-hold", "rejected"],
        "dcrStatuses": ["submitted", "in progress", "escalated", "reject"],
        "meetingStatuses": ["N/A", "Scheduling", "Scheduled", "TBR"],
    },
    "clients": [],
    "items": [],
}

ITEM_FIELDS = {
    "clientId", "source", "adoId", "adoUrl", "type", "title", "state", "assignedTo",
    "clientOwner", "priority", "storyPoints", "risk", "valueArea", "tags", "description",
    "acceptance", "dueDate", "order", "archived",
    "escalatedTo", "escalationStatus", "cssCase", "cssCaseNumber",
    "dcr", "dcrId", "dcrStatus", "meetingStatus",
}
CLIENT_FIELDS = {
    "name", "packageName", "packageId", "status", "knowMeUrl", "contractEnd",
    "adoOrg", "adoProject", "notes", "archived",
    "clientLead", "clientLeadRole", "clientLeadEmail", "searchTerms", "scanEnabled",
    "scanRequested", "lastScan",
}

# Fields that must always be stored as a list, never a bare string.
LIST_FIELDS = {"tags", "escalatedTo"}


def coerce_lists(data: dict) -> dict:
    """Normalize list-valued fields so a bare string never reaches the store."""
    for key in LIST_FIELDS:
        if key not in data:
            continue
        val = data[key]
        if val is None or val == "":
            data[key] = []
        elif isinstance(val, str):
            data[key] = [p.strip() for p in val.split(",") if p.strip()]
        elif not isinstance(val, list):
            data[key] = [val]
    return data


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or uuid.uuid4().hex[:8]


def load_store() -> dict:
    if not os.path.exists(STORE):
        os.makedirs(DATA_DIR, exist_ok=True)
        save_store(json.loads(json.dumps(DEFAULT_STORE)), backup=False)
    with open(STORE, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    for key, val in DEFAULT_STORE.items():
        data.setdefault(key, json.loads(json.dumps(val)))
    for key, val in DEFAULT_STORE["settings"].items():
        data["settings"].setdefault(key, val)
    return data


def save_store(data: dict, backup: bool = True) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUPS, exist_ok=True)
    if backup and os.path.exists(STORE):
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(STORE, os.path.join(BACKUPS, f"store-{stamp}.json"))
        old = sorted(os.listdir(BACKUPS))
        for name in old[:-MAX_BACKUPS]:
            try:
                os.remove(os.path.join(BACKUPS, name))
            except OSError:
                pass
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE)


def unique_client_id(store: dict, base: str) -> str:
    existing = {c["id"] for c in store["clients"]}
    cid, n = base, 2
    while cid in existing:
        cid, n = f"{base}-{n}", n + 1
    return cid


README_SHELL = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__NAME__ — documentation</title>
<script>
(() => {
  const p = new URLSearchParams(location.search).get("scoutTheme");
  const t = p || localStorage.getItem("sfmcTheme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", t);
})();
</script>
<link rel="stylesheet" href="/styles.css">
<style>
  body { display:block; }
  .doc { max-width: 980px; margin: 0 auto; padding: 28px 28px 90px; }
  .doc img { max-width: 100%; border:1px solid var(--cp-border); border-radius: 0.625rem; margin: 6px 0 18px; }
  .doc h1 { font-size: 30px; margin: 0 0 6px; }
  .doc h2 { font-size: 21px; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--cp-border); }
  .doc h3 { font-size: 16px; margin: 24px 0 8px; }
  .doc h4 { font-size: 14px; margin: 18px 0 6px; color: var(--cp-text-muted); }
  .doc p, .doc li { line-height: 1.62; }
  .doc code { font-family: Consolas,"Courier New",monospace; font-size: 12.5px;
    background: var(--cp-surface-soft); border:1px solid var(--cp-border);
    border-radius: 4px; padding: 1px 5px; }
  .doc pre { background: var(--cp-surface); border:1px solid var(--cp-border);
    border-radius: 0.625rem; padding: 14px 16px; overflow-x:auto; line-height:1.45; }
  .doc pre code { background:none; border:none; padding:0; }
  .doc table { margin: 12px 0 20px; }
  .doc th, .doc td { font-size: 13px; }
  .doc blockquote { border-left:3px solid var(--cp-accent); margin:0; padding:4px 14px; color: var(--cp-text-muted); }
  .docbar { position: sticky; top:0; z-index:5; background: var(--cp-bg-elevated);
    border-bottom:1px solid var(--cp-border); padding:10px 18px; display:flex; gap:10px; align-items:center; }
</style></head>
<body>
<div class="docbar">
  <span class="logo">__LOGO__</span>
  <strong>Documentation</strong>
  <span class="spacer" style="flex:1"></span>
  <a class="btn" href="/">← Back to boards</a>
</div>
<div class="doc"><!--BODY--></div>
</body></html>
"""


PROPOSAL_FIELDS = {
    "clientId", "kind", "evidence", "source", "item", "patch",
    "targetItemId", "targetTitle", "note", "runId", "date",
}


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def title_similarity(a: str, b: str) -> float:
    """Token overlap between two normalized titles (0-1)."""
    ta, tb = set(norm_title(a).split()), set(norm_title(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def derive_search_terms(name: str) -> str:
    """Best-effort aliases for a brand-new client so it is scannable on day one.
    Always review these - legal names and case aliases (an operating company that
    differs from the display name) can only come from a human."""
    n = (name or "").strip()
    if not n:
        return ""
    terms = [n]
    # drop common corporate suffixes for a shorter alias
    short = re.sub(r"\b(inc|llc|llp|ltd|limited|corp|corporation|company|co|group|plc|sa|nv|ag|gmbh)\b\.?",
                   "", n, flags=re.I)
    short = re.sub(r"[,&]", " ", short)
    short = re.sub(r"\s+", " ", short).strip()
    if short and short.lower() != n.lower():
        terms.append(short)
    # naive domain guess from the first meaningful word
    first = re.sub(r"[^a-z0-9]", "", short.split(" ")[0].lower()) if short else ""
    if len(first) > 2:
        terms.append(f"{first}.com")
    seen, out = set(), []
    for t in terms:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            out.append(t)
    return ", ".join(out)


def load_proposals() -> dict:
    if not os.path.exists(PROPOSALS):
        return {"version": 1, "proposals": []}
    with open(PROPOSALS, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    data.setdefault("proposals", [])
    return data


def save_proposals(data: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = PROPOSALS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, PROPOSALS)


def match_existing(prop: dict, store: dict) -> dict | None:
    """Find the board item a proposal refers to: explicit target, else closest title."""
    items = [i for i in store["items"] if i.get("clientId") == prop.get("clientId")]
    if prop.get("targetItemId"):
        return next((i for i in items if i["id"] == prop["targetItemId"]), None)
    title = (prop.get("item") or {}).get("title") or prop.get("targetTitle") or ""
    best, score = None, 0.0
    for it in items:
        s = title_similarity(title, it.get("title", ""))
        if s > score:
            best, score = it, s
    return best if score >= 0.55 else None


def decorate_proposals(pdata: dict, store: dict, status: str | None = None) -> list:
    out = []
    clients = {c["id"]: c for c in store["clients"]}
    for p in pdata["proposals"]:
        if status and p.get("status") != status:
            continue
        p = json.loads(json.dumps(p))
        m = match_existing(p, store)
        p["match"] = m
        p["clientName"] = (clients.get(p.get("clientId")) or {}).get("name", p.get("clientId"))
        if m:
            title = (p.get("item") or {}).get("title") or p.get("targetTitle") or ""
            p["matchScore"] = round(title_similarity(title, m.get("title", "")), 2)
        out.append(p)
    return out


def run_ado_sync() -> dict:
    """Run Sync-AzureDevOps.ps1 and report what it did. The script owns the file write."""
    script = os.path.join(ROOT, "Sync-AzureDevOps.ps1")
    if not os.path.exists(script):
        raise ValueError("Sync-AzureDevOps.ps1 not found")
    shell = shutil.which("pwsh") or shutil.which("powershell")
    if not shell:
        raise ValueError("PowerShell was not found on PATH")
    proc = subprocess.run(
        [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        capture_output=True, text=True, cwd=ROOT, timeout=600,
    )
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode != 0:
        raise ValueError(f"Sync failed: {err or out or 'unknown error'}")
    return {"ok": True, "output": out, "warnings": err}


class Handler(SimpleHTTPRequestHandler):
    server_version = "SfmcBoards/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    # ---------- helpers ----------
    def _json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    # ---------- routing ----------
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/api/store":
            with _lock:
                data = load_store()
            data["instance"] = INSTANCE
            return self._json(data)
        if path == "/api/proposals":
            qs = parse_qs(urlparse(self.path).query)
            status = (qs.get("status") or ["pending"])[0]
            with _lock:
                pdata, store = load_proposals(), load_store()
                items = decorate_proposals(pdata, store, None if status == "all" else status)
                counts = {}
                for p in pdata["proposals"]:
                    counts[p.get("status", "pending")] = counts.get(p.get("status", "pending"), 0) + 1
                return self._json({"proposals": items, "counts": counts})
        if path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        if path in ("/readme", "/readme/"):
            return self._readme()
        if path in ("/proposals", "/proposals/"):
            self.path = "/index.html"
            return super().do_GET()
        if path.startswith("/docs/"):
            return self._serve_from_root(path)
        return super().do_GET()

    def _serve_from_root(self, path: str):
        """Serve files under docs/ - README screenshots and the overview deck."""
        rel = os.path.normpath(path.lstrip("/")).replace("\\", "/")
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._json({"error": "not found"}, 404)
        ctype = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".svg": "image/svg+xml",
            ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
            ".md": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8",
        }.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _readme(self):
        md_path = os.path.join(ROOT, "README.md")
        if not os.path.exists(md_path):
            return self._json({"error": "README.md not found"}, 404)
        with open(md_path, "r", encoding="utf-8") as fh:
            text = fh.read()
        try:
            import markdown
            body = markdown.markdown(
                text, extensions=["tables", "fenced_code", "toc", "sane_lists"])
        except Exception:
            import html as _html
            body = "<pre>" + _html.escape(text) + "</pre>"
        page = (README_SHELL.replace("<!--BODY-->", body)
                .replace("__NAME__", INSTANCE["name"])
                .replace("__LOGO__", INSTANCE["logo"]))
        out = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):
        return self._mutate("POST")

    def do_PUT(self):
        return self._mutate("PUT")

    def do_DELETE(self):
        return self._mutate("DELETE")

    def _mutate(self, method: str):
        path = urlparse(self.path).path
        try:
            body = self._body()
        except Exception as exc:
            return self._json({"error": f"bad json: {exc}"}, 400)

        with _lock:
            store = load_store()
            try:
                result = self._dispatch(method, path, body, store)
            except KeyError as exc:
                return self._json({"error": f"not found: {exc}"}, 404)
            except ValueError as exc:
                return self._json({"error": str(exc)}, 400)
            if result is None:
                return self._json({"error": "not found"}, 404)
            payload, changed = result
            if changed:
                save_store(store)
            return self._json(payload)

    def _dispatch(self, method: str, path: str, body: dict, store: dict):
        # ---- proposals ----
        if path == "/api/proposals" and method == "POST":
            return self._ingest_proposals(body, store)

        m = re.fullmatch(r"/api/proposals/([^/]+)/decide", path)
        if m and method == "POST":
            return self._decide_proposal([m.group(1)], body.get("action"), store)

        if path == "/api/proposals/decide" and method == "POST":
            return self._decide_proposal(body.get("ids") or [], body.get("action"), store)

        if path == "/api/scan-queue" and method == "POST":
            """Queue clients for the next scan. ids=[...] or scope=new|all."""
            scope = body.get("scope")
            ids = set(body.get("ids") or [])
            queued = []
            for c in store["clients"]:
                if c.get("archived") or not c.get("scanEnabled", True):
                    continue
                want = (c["id"] in ids) or scope == "all" or (
                    scope == "new" and not c.get("lastScan"))
                if want:
                    c["scanRequested"] = True
                    queued.append(c["id"])
            if not queued:
                raise ValueError("no matching clients to queue")
            return {"ok": True, "queued": queued}, True

        if path == "/api/proposals/purge" and method == "POST":
            pdata = load_proposals()
            before = len(pdata["proposals"])
            keep = body.get("keep") or "pending"
            pdata["proposals"] = [p for p in pdata["proposals"]
                                  if p.get("status") == "pending"] if keep == "pending" else []
            save_proposals(pdata)
            return {"ok": True, "removed": before - len(pdata["proposals"])}, False

        # ---- items ----
        if path == "/api/items" and method == "POST":
            return self._create_item(body, store), True

        m = re.fullmatch(r"/api/items/([^/]+)", path)
        if m and method == "PUT":
            return self._update_item(m.group(1), body, store), True
        if m and method == "DELETE":
            before = len(store["items"])
            store["items"] = [i for i in store["items"] if i["id"] != m.group(1)]
            if len(store["items"]) == before:
                raise KeyError(m.group(1))
            return {"ok": True}, True

        m = re.fullmatch(r"/api/items/([^/]+)/comments", path)
        if m and method == "POST":
            item = self._find_item(m.group(1), store)
            text = (body.get("text") or "").strip()
            if not text:
                raise ValueError("comment text is required")
            item.setdefault("comments", []).append({
                "id": uuid.uuid4().hex[:12],
                "by": body.get("by") or "Me",
                "date": now_iso(),
                "text": text,
            })
            item["changed"] = now_iso()
            return item, True

        if path == "/api/items/reorder" and method == "POST":
            for entry in body.get("moves", []):
                item = self._find_item(entry["id"], store)
                if item.get("source") == "ado":
                    continue
                if "state" in entry:
                    item["state"] = entry["state"]
                if "order" in entry:
                    item["order"] = entry["order"]
                item["changed"] = now_iso()
            return {"ok": True}, True

        if path == "/api/items/bulk" and method == "POST":
            ids = set(body.get("ids") or [])
            action = body.get("action")
            if not ids:
                raise ValueError("no items selected")
            if action == "delete":
                before = len(store["items"])
                store["items"] = [i for i in store["items"] if i["id"] not in ids]
                return {"ok": True, "affected": before - len(store["items"])}, True
            patch = {"archived": True} if action == "archive" else \
                    {"archived": False} if action == "unarchive" else \
                    (body.get("patch") or {})
            patch = {k: v for k, v in patch.items() if k in ITEM_FIELDS}
            if not patch:
                raise ValueError("nothing to apply")
            n = 0
            for item in store["items"]:
                if item["id"] not in ids:
                    continue
                if item.get("source") == "ado":
                    allowed = {"state", "order", "tags", "archived", "clientOwner",
                               "escalatedTo", "escalationStatus", "cssCase", "cssCaseNumber",
                       "dcr", "dcrId", "dcrStatus", "meetingStatus"}
                    safe = {k: v for k, v in patch.items() if k in allowed}
                else:
                    safe = patch
                if not safe:
                    continue
                item.update(safe)
                item["changed"] = now_iso()
                n += 1
            return {"ok": True, "affected": n}, True

        # ---- clients ----
        if path == "/api/clients" and method == "POST":
            name = (body.get("name") or "").strip()
            if not name:
                raise ValueError("client name is required")
            client = {k: "" for k in CLIENT_FIELDS}
            client.update({"archived": False, "status": "pending"})
            client.update({k: v for k, v in body.items() if k in CLIENT_FIELDS})
            client["name"] = name
            client["id"] = unique_client_id(store, slugify(name))
            client["created"] = now_iso()
            # every new client is scan-ready on day one: enabled, seeded aliases,
            # and queued for a first pass so it never sits at "never scanned".
            if not body.get("searchTerms"):
                client["searchTerms"] = derive_search_terms(name)
            if "scanEnabled" not in body:
                client["scanEnabled"] = True
            if "scanRequested" not in body:
                client["scanRequested"] = bool(client.get("scanEnabled"))
            store["clients"].append(client)
            return client, True

        m = re.fullmatch(r"/api/clients/([^/]+)", path)
        if m and method == "PUT":
            client = next((c for c in store["clients"] if c["id"] == m.group(1)), None)
            if client is None:
                raise KeyError(m.group(1))
            client.update({k: v for k, v in body.items() if k in CLIENT_FIELDS})
            client["changed"] = now_iso()
            # optionally stamp the client-side lead onto this client's work items
            if body.get("applyLeadToItems"):
                lead = client.get("clientLead") or ""
                overwrite = bool(body.get("overwriteItemOwners"))
                for item in store["items"]:
                    if item.get("clientId") != client["id"]:
                        continue
                    if overwrite or not item.get("clientOwner"):
                        item["clientOwner"] = lead
                        item["changed"] = now_iso()
            return client, True
        if m and method == "DELETE":
            cid = m.group(1)
            if not any(c["id"] == cid for c in store["clients"]):
                raise KeyError(cid)
            store["clients"] = [c for c in store["clients"] if c["id"] != cid]
            store["items"] = [i for i in store["items"] if i.get("clientId") != cid]
            return {"ok": True}, True

        # ---- azure devops sync ----
        if path == "/api/sync-ado" and method == "POST":
            # the script writes the store itself; don't re-save our stale copy
            return run_ado_sync(), False

        # ---- settings ----
        if path == "/api/settings" and method == "PUT":
            store["settings"].update(body or {})
            return store["settings"], True

        return None

    # ---- proposal helpers ----
    def _ingest_proposals(self, body: dict, store: dict):
        """Accept a batch from the daily scan. Drops anything already pending."""
        incoming = body.get("proposals") or []
        if not isinstance(incoming, list) or not incoming:
            raise ValueError("proposals array is required")
        pdata = load_proposals()
        pending = [p for p in pdata["proposals"] if p.get("status") == "pending"]
        added, duplicates = 0, 0
        for raw in incoming:
            prop = {k: v for k, v in raw.items() if k in PROPOSAL_FIELDS}
            if not prop.get("clientId"):
                continue
            title = (prop.get("item") or {}).get("title") or prop.get("targetTitle") or ""
            if any(p.get("clientId") == prop["clientId"]
                   and title_similarity(title, (p.get("item") or {}).get("title")
                                        or p.get("targetTitle") or "") >= 0.85
                   for p in pending):
                duplicates += 1
                continue
            prop.update({
                "id": uuid.uuid4().hex[:12],
                "status": "pending",
                "kind": prop.get("kind") or "add",
                "evidence": prop.get("evidence") or "inferred",
                "created": now_iso(),
            })
            pdata["proposals"].append(prop)
            pending.append(prop)
            added += 1
        save_proposals(pdata)
        return {"ok": True, "added": added, "duplicates": duplicates,
                "pending": len(pending)}, False

    def _decide_proposal(self, ids: list, action: str, store: dict):
        """accept = apply it · skip = discard it · archive/delete = act on the CURRENT item."""
        if action not in ("accept", "skip", "archive", "delete"):
            raise ValueError("action must be accept, skip, archive or delete")
        if not ids:
            raise ValueError("no proposals selected")
        pdata = load_proposals()
        by_id = {p["id"]: p for p in pdata["proposals"]}
        changed_store, results = False, []

        for pid in ids:
            prop = by_id.get(pid)
            if not prop:
                results.append({"id": pid, "ok": False, "error": "not found"})
                continue
            try:
                if action == "skip":
                    pass
                elif action == "accept":
                    if prop.get("kind") == "add":
                        payload = dict(prop.get("item") or {})
                        payload["clientId"] = prop["clientId"]
                        self._create_item(payload, store)
                    else:
                        target = prop.get("targetItemId") or (
                            (match_existing(prop, store) or {}).get("id"))
                        if not target:
                            raise ValueError("no matching item to update")
                        self._update_item(target, dict(prop.get("patch") or {}), store)
                    changed_store = True
                else:  # archive / delete act on the existing board item
                    target = prop.get("targetItemId") or (
                        (match_existing(prop, store) or {}).get("id"))
                    if not target:
                        raise ValueError("no matching current item")
                    if action == "archive":
                        self._update_item(target, {"archived": True}, store)
                    else:
                        store["items"] = [i for i in store["items"] if i["id"] != target]
                    changed_store = True
                prop["status"] = {"accept": "accepted", "skip": "skipped",
                                  "archive": "archived", "delete": "deleted"}[action]
                prop["decidedAt"] = now_iso()
                results.append({"id": pid, "ok": True, "action": action})
            except Exception as exc:
                results.append({"id": pid, "ok": False, "error": str(exc)})

        save_proposals(pdata)
        ok = sum(1 for r in results if r["ok"])
        return {"ok": True, "affected": ok, "results": results}, changed_store

    # ---- item helpers ----
    @staticmethod
    def _find_item(item_id: str, store: dict) -> dict:
        item = next((i for i in store["items"] if i["id"] == item_id), None)
        if item is None:
            raise KeyError(item_id)
        return item

    def _create_item(self, body: dict, store: dict) -> dict:
        title = (body.get("title") or "").strip()
        if not title:
            raise ValueError("title is required")
        client_id = body.get("clientId")
        client = next((c for c in store["clients"] if c["id"] == client_id), None)
        if client is None:
            raise ValueError("valid clientId is required")
        columns = store["settings"]["columns"]
        state = body.get("state") or columns[0]
        siblings = [i for i in store["items"]
                    if i.get("clientId") == client_id and i.get("state") == state]
        item = {
            "id": uuid.uuid4().hex[:12],
            "source": "manual",
            "type": body.get("type") or store["settings"]["types"][0],
            "state": state,
            "order": (max([i.get("order", 0) for i in siblings]) + 1) if siblings else 0,
            "tags": [],
            "comments": [],
            "escalatedTo": [],
            "escalationStatus": "",
            "cssCase": False,
            "cssCaseNumber": "",
            "dcr": False,
            "dcrId": "",
            "dcrStatus": "",
            "meetingStatus": "",
            "created": now_iso(),
            "changed": now_iso(),
            "createdBy": body.get("createdBy") or "Me",
        }
        item.update({k: v for k, v in body.items() if k in ITEM_FIELDS})
        coerce_lists(item)
        item["title"] = title
        item["clientId"] = client_id
        item["source"] = "manual"
        if not item.get("clientOwner"):
            item["clientOwner"] = client.get("clientLead") or ""
        store["items"].append(item)
        return item

    def _update_item(self, item_id: str, body: dict, store: dict) -> dict:
        item = self._find_item(item_id, store)
        if item.get("source") == "ado":
            allowed = {"state", "order", "tags", "archived", "clientOwner",
                       "escalatedTo", "escalationStatus", "cssCase", "cssCaseNumber",
                       "dcr", "dcrId", "dcrStatus", "meetingStatus"}
            body = {k: v for k, v in body.items() if k in allowed}
        item.update({k: v for k, v in body.items() if k in ITEM_FIELDS})
        coerce_lists(item)
        if "title" in body and (body["title"] or "").strip():
            item["title"] = body["title"].strip()
        item["changed"] = now_iso()
        return item


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=INSTANCE["port"])
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    # Under pythonw.exe (windowless, used by the watchdog) sys.stdout and
    # sys.stderr are None. Any print() or request log then raises and the
    # server binds the port but can never answer. Send both to a log file.
    if sys.stdout is None or sys.stderr is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        stream = open(os.path.join(DATA_DIR, "server.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = stream
        sys.stderr = stream

    load_store()  # create if missing
    # Refuse to start if something already holds the port. Python's HTTPServer
    # sets allow_reuse_address, which on Windows lets a second process bind the
    # same port instead of failing - two servers then split requests between
    # them and the API appears to hang. One server per port, always.
    ThreadingHTTPServer.allow_reuse_address = False
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as exc:
        print(f"Port {args.port} is already in use - not starting a second copy. ({exc})")
        raise SystemExit(1)

    url = f"http://127.0.0.1:{args.port}/"
    print(f"{INSTANCE['name']} running at {url}")
    print(f"Store: {STORE}")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()

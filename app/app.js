/* Client Boards — front end */
"use strict";

let STORE = { settings: {}, clients: [], items: [] };
const UI = {
  view: "board",
  client: localStorage.getItem("sfmcClient") || "all",
  q: "",
  assignee: "",
  clientOwner: "",
  escalation: "",
  meeting: "",
  type: "",
  hideClosed: localStorage.getItem("sfmcHideClosed") === "1",
  collapsed: new Set(JSON.parse(localStorage.getItem("sfmcCollapsed") || "[]")),
  itemsState: "",
  itemsPriority: "",
  showArchived: false,
  selected: new Set(),
  sort: { key: "changed", dir: "desc" },
  dashState: "",
  dashDays: 30,
};

/** Single source of truth for "which client am I looking at" — shared by
 *  the rail, the boards, the items list and the dashboard. */
function setClient(id) {
  UI.client = id;
  localStorage.setItem("sfmcClient", id);
}

const STATE_COLOR = {
  "New": "var(--cp-text-soft)",
  "Active": "var(--cp-link)",
  "In Progress": "var(--cp-link)",
  "Resolved": "var(--cp-warning)",
  "Closed": "var(--cp-success)",
  "Removed": "var(--cp-danger)",
};

/* ---------------- helpers ---------------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const isClosed = s => /^(Closed|Removed|Done)$/i.test(s || "");
const columns = () => STORE.settings.columns || ["New", "Active", "In Progress", "Resolved", "Closed"];

function fmtDate(d) {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function daysUntil(d) {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : new Date(d);
  if (isNaN(dt)) return null;
  return Math.ceil((dt - new Date()) / 86400000);
}
function contractPill(client, alertsOnly) {
  const days = daysUntil(client.contractEnd);
  if (days === null) return "";
  if (days < 0) return `<span class="pill bad">expired ${fmtDate(client.contractEnd)}</span>`;
  if (days <= 90) return `<span class="pill warn">ends in ${days}d</span>`;
  return alertsOnly ? "" : `<span class="pill ok">to ${fmtDate(client.contractEnd)}</span>`;
}
function toast(msg, isErr) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 2600);
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
// Internal (non-customer) clients always sort to the bottom. The list comes
// from instance.json so the same app.js serves every deployment.
function sortClients(clients) {
  const pinned = (STORE.instance && STORE.instance.pinnedBottom) || [];
  return clients.slice().sort((a, b) => {
    const pa = pinned.indexOf(a.id);
    const pb = pinned.indexOf(b.id);
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return -1;
      if (pb === -1) return 1;
      return pa - pb;
    }
    return (a.name || "").localeCompare(b.name || "", "en", { sensitivity: "base" });
  });
}

// Apply per-instance branding: page title, logo badge, header text, and hide
// Azure DevOps controls on deployments that have no ADO link.
function applyInstance() {
  const inst = STORE.instance || {};
  if (inst.name) document.title = inst.name;
  const logo = document.querySelector(".brand .logo");
  const h1 = document.querySelector(".brand h1");
  if (logo && inst.logo) logo.textContent = inst.logo;
  if (h1 && inst.title) h1.textContent = inst.title;
  const sync = document.getElementById("syncBtn");
  if (sync && inst.adoEnabled === false) sync.style.display = "none";
  if (inst.demo) document.body.classList.add("is-demo");
}

// Fields the UI treats as arrays. Bad data (a bare string) would otherwise
// throw inside render() and blank the entire app, so coerce on load.
const LIST_FIELDS = ["tags", "escalatedTo"];

function normalizeItems(items) {
  for (const it of items) {
    for (const k of LIST_FIELDS) {
      const v = it[k];
      if (Array.isArray(v)) continue;
      if (v === null || v === undefined || v === "") it[k] = [];
      else if (typeof v === "string") it[k] = v.split(",").map(s => s.trim()).filter(Boolean);
      else it[k] = [v];
    }
  }
  return items;
}

async function reload() {
  STORE = await api("/api/store");
  STORE.clients = sortClients(STORE.clients || []);
  STORE.items = normalizeItems(STORE.items || []);
  applyInstance();
  render();
}

const clientById = id => STORE.clients.find(c => c.id === id);
const itemsOf = id => STORE.items.filter(i => i.clientId === id && !i.archived);

function matches(it) {
  if (UI.hideClosed && isClosed(it.state)) return false;
  if (UI.assignee && (it.assignedTo || "") !== UI.assignee) return false;
  if (UI.clientOwner) {
    if (UI.clientOwner === "__none__") { if (it.clientOwner) return false; }
    else if ((it.clientOwner || "") !== UI.clientOwner) return false;
  }
  if (UI.type && it.type !== UI.type) return false;
  if (UI.meeting && (it.meetingStatus || "") !== UI.meeting) return false;
  if (UI.escalation) {
    const to = (it.escalatedTo || []).filter(Boolean);
    if (UI.escalation === "__any__") { if (!isEscalated(it)) return false; }
    else if (UI.escalation === "__css__") { if (!it.cssCase) return false; }
    else if (UI.escalation === "__dcr__") { if (!it.dcr && !it.dcrStatus) return false; }
    else if (UI.escalation.startsWith("dcr:")) {
      if ((it.dcrStatus || "") !== UI.escalation.slice(4)) return false;
    }
    else if ((STORE.settings.escalationStatuses || []).includes(UI.escalation)) {
      if (it.escalationStatus !== UI.escalation) return false;
    } else if (!to.includes(UI.escalation)) return false;
  }
  if (UI.q) {
    const hay = [it.title, it.assignedTo, it.clientOwner, it.state, it.type, (it.tags || []).join(" "),
                 (it.escalatedTo || []).join(" "), it.escalationStatus, it.cssCaseNumber,
                 it.dcrId, it.dcrStatus, it.meetingStatus, it.description, it.adoId].join(" ").toLowerCase();
    if (!hay.includes(UI.q.toLowerCase())) return false;
  }
  return true;
}

/* ---------------- rail ---------------- */
function renderRail() {
  const active = STORE.clients.filter(c => !c.archived);
  const totalOpen = STORE.items.filter(i => !i.archived && !isClosed(i.state)).length;
  $("#rail").innerHTML = `
    <div class="rail-head"><span>Portfolio</span><span>${active.length}</span></div>
    <button class="rail-item ${UI.client === "all" ? "on" : ""}" data-client="all">
      <div class="rail-name">All clients</div>
      <div class="rail-sub"><span class="pill accent">${totalOpen} open</span><span class="pill">${STORE.items.length} items</span></div>
    </button>
    <div class="rail-head" style="margin-top:10px"><span>Clients</span></div>
    ${active.map(c => {
      const its = itemsOf(c.id);
      const open = its.filter(i => !isClosed(i.state)).length;
      return `<button class="rail-item ${UI.client === c.id ? "on" : ""}" data-client="${esc(c.id)}">
        <div class="rail-name">${esc(c.name)}</div>
        <div class="rail-sub">
          <span class="pill accent">${open} open</span>
          <span class="pill">${its.length}</span>
          ${c.adoProject ? '<span class="pill">ADO</span>' : ""}
          ${contractPill(c)}
        </div>
      </button>`;
    }).join("")}
    <button class="rail-item" id="railAddClient" style="margin-top:8px;color:var(--cp-accent)">+ Add client</button>`;
}

/* ---------------- board ---------------- */
function escalationChip(it) {
  const to = (it.escalatedTo || []).filter(Boolean);
  const st = it.escalationStatus || "";
  if (!to.length && !st) return "";
  const cls = st === "rejected" ? "esc bad" : st === "on-hold" ? "esc warn" : "esc";
  const label = [to.join(" + "), st].filter(Boolean).join(" · ");
  return `<span class="${cls}" title="Escalated to ${esc(to.join(", ") || "—")}${st ? " · " + esc(st) : ""}">↑ ${esc(label)}</span>`;
}
function cssChip(it) {
  if (!it.cssCase) return "";
  return `<span class="css-chip" title="CSS case${it.cssCaseNumber ? " " + esc(it.cssCaseNumber) : ""}">CSS${it.cssCaseNumber ? " " + esc(it.cssCaseNumber) : ""}</span>`;
}
function dcrChip(it) {
  if (!it.dcr && !it.dcrStatus) return "";
  const st = it.dcrStatus || "";
  const cls = st === "reject" ? "dcr-chip bad" : st === "escalated" ? "dcr-chip warn" : "dcr-chip";
  const label = ["DCR", it.dcrId, st ? "· " + st : ""].filter(Boolean).join(" ");
  return `<span class="${cls}" title="DCR${it.dcrId ? " " + esc(it.dcrId) : ""}${st ? " · " + esc(st) : ""}">${esc(label)}</span>`;
}
function meetingChip(it) {
  const s = it.meetingStatus || "";
  if (!s || s === "N/A") return "";
  const cls = s === "TBR" ? "meet-chip bad" : s === "Scheduling" ? "meet-chip warn" : "meet-chip ok";
  const label = s === "TBR" ? "TBR (to be rescheduled)" : s;
  return `<span class="${cls}" title="Meeting status: ${esc(label)}">${esc(s)}</span>`;
}
/** An item counts as escalated if it went to PM/PG/CSAM, has an escalation status, or has a DCR. */
function isEscalated(it) {
  return !!((it.escalatedTo || []).length || it.escalationStatus || it.dcr || it.dcrStatus);
}

function cardHtml(it) {
  const color = STATE_COLOR[it.state] || "var(--cp-border-strong)";
  const ado = it.source === "ado";
  return `<div class="card" draggable="true" data-id="${esc(it.id)}" style="border-left-color:${color}">
    <div class="card-top">
      ${ado ? `<span class="badge-ado">ADO ${esc(it.adoId || "")}</span>` : ""}
      <span>${esc(it.type || "")}</span>
      ${it.priority ? `<span>· P${esc(it.priority)}</span>` : ""}
      ${it.storyPoints ? `<span>· ${esc(it.storyPoints)} pts</span>` : ""}
      ${(it.comments || []).length ? `<span>· ${it.comments.length} 💬</span>` : ""}
      ${it.dueDate ? `<span>· due ${fmtDate(it.dueDate)}</span>` : ""}
    </div>
    <div class="card-title">${esc(it.title)}</div>
    <div class="card-meta">
      <span class="dot" style="background:${color}"></span>${esc(it.state)}
      <span class="avatar" title="Microsoft owner: ${esc(it.assignedTo || "Unassigned")}">${esc(initials(it.assignedTo))}</span>
      <span>${esc(it.assignedTo || "Unassigned")}</span>
      ${it.clientOwner
        ? `<span class="avatar client" title="Client owner: ${esc(it.clientOwner)}">${esc(initials(it.clientOwner))}</span><span class="client-owner">${esc(it.clientOwner)}</span>`
        : ""}
      ${escalationChip(it)}
      ${cssChip(it)}
      ${dcrChip(it)}
      ${meetingChip(it)}
      ${(it.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
    </div>
  </div>`;
}

function boardSection(c) {
  const all = itemsOf(c.id);
  const vis = all.filter(matches);
  const open = !UI.collapsed.has(c.id);
  const cols = columns();
  const body = cols.map(col => {
    const cards = vis.filter(i => (i.state || cols[0]) === col)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return `<div class="col">
      <div class="col-head"><span class="col-name">${esc(col)}</span><span class="col-count">${cards.length}</span></div>
      <div class="drop" data-client="${esc(c.id)}" data-col="${esc(col)}">
        ${cards.length ? cards.map(cardHtml).join("") : '<div class="empty">No items</div>'}
      </div>
      <button class="add-card" data-add="${esc(c.id)}" data-state="${esc(col)}">+ Add</button>
    </div>`;
  }).join("");

  return `<section class="client">
    <div class="client-head">
      <span class="caret" data-toggle="${esc(c.id)}">${open ? "▾" : "▸"}</span>
      <h2>${esc(c.name)}</h2>
      <span class="pill accent">${all.filter(i => !isClosed(i.state)).length} open</span>
      <span class="pill">${all.length} total</span>
      <span class="pill">${esc(c.packageName || "—")}</span>
      <span class="pill">#${esc(c.packageId || "—")}</span>
      <span class="pill ${c.status === "completed" ? "ok" : "warn"}">${esc(c.status || "—")}</span>
      ${c.clientLead
        ? `<span class="pill lead" title="${esc([c.clientLeadRole, c.clientLeadEmail].filter(Boolean).join(" · ") || "Client-side lead")}">Client lead: ${esc(c.clientLead)}</span>`
        : `<span class="pill warn">Client lead not set</span>`}
      ${contractPill(c)}
      <span class="spacer"></span>
      ${c.knowMeUrl ? `<a class="pill" href="${esc(c.knowMeUrl)}" target="_blank" rel="noopener">Know-Me ↗</a>` : ""}
      ${c.adoProject ? `<a class="pill" href="https://dev.azure.com/${encodeURIComponent(c.adoOrg)}/${encodeURIComponent(c.adoProject)}" target="_blank" rel="noopener">Azure DevOps ↗</a>` : ""}
      <button class="btn sm" data-editclient="${esc(c.id)}">Edit</button>
    </div>
    ${open ? `<div class="board" style="grid-template-columns:repeat(${cols.length},minmax(240px,1fr))">${body}</div>` : ""}
  </section>`;
}

function renderBoard() {
  const list = UI.client === "all"
    ? STORE.clients.filter(c => !c.archived)
    : [clientById(UI.client)].filter(Boolean);
  if (!list.length) {
    $("#main").innerHTML = `<div class="empty">No clients yet — add one from the left rail.</div>`;
    return;
  }
  $("#main").innerHTML = list.map(boardSection).join("");
}

/* ---------------- clients view ---------------- */
function renderClients() {
  $("#main").innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0;font-size:15px">Clients &amp; contracts</h2>
      <span class="spacer grow"></span>
      ${STORE.clients.some(c => c.scanEnabled && !c.archived && !c.lastScan)
        ? `<button class="btn" id="scanNew">⟳ Scan never-scanned (${STORE.clients.filter(c => c.scanEnabled && !c.archived && !c.lastScan).length})</button>` : ""}
      <button class="btn primary" id="addClientBtn">+ Add client</button>
    </div>
    <table>
      <thead><tr>
        <th>Customer</th><th>Client-side lead</th><th>Package</th><th>Package ID</th><th>Status</th>
        <th>Contract ends</th><th>Items</th><th>Scan</th><th>Links</th><th></th>
      </tr></thead>
      <tbody>${STORE.clients.map(c => {
        const its = itemsOf(c.id);
        const unowned = its.filter(i => !i.clientOwner && !isClosed(i.state)).length;
        return `<tr>
          <td><strong>${esc(c.name)}</strong>${c.archived ? ' <span class="pill">archived</span>' : ""}</td>
          <td>${c.clientLead
            ? `<strong>${esc(c.clientLead)}</strong>${c.clientLeadRole ? `<div class="sub">${esc(c.clientLeadRole)}</div>` : ""}
               ${c.clientLeadEmail ? `<div class="sub"><a href="mailto:${esc(c.clientLeadEmail)}">${esc(c.clientLeadEmail)}</a></div>` : ""}
               ${unowned ? `<span class="pill warn">${unowned} open item(s) unowned</span>` : ""}`
            : '<span class="pill warn">not set</span>'}</td>
          <td>${esc(c.packageName || "—")}</td>
          <td class="num">${esc(c.packageId || "—")}</td>
          <td><span class="pill ${c.status === "completed" ? "ok" : "warn"}">${esc(c.status || "—")}</span></td>
          <td>${fmtDate(c.contractEnd)} ${contractPill(c, true)}</td>
          <td>${its.filter(i => !isClosed(i.state)).length} open / ${its.length}</td>
          <td>${!c.scanEnabled ? '<span class="pill">off</span>'
            : c.scanRequested ? '<span class="pill accent">queued</span>'
            : !c.lastScan ? '<span class="pill warn">never scanned</span>'
            : `<span class="sub">${fmtDate(c.lastScan)}</span>`}</td>
          <td>
            ${[
              c.knowMeUrl ? `<a href="${esc(c.knowMeUrl)}" target="_blank" rel="noopener">Know-Me</a>` : "",
              c.adoProject ? `<a href="https://dev.azure.com/${encodeURIComponent(c.adoOrg)}/${encodeURIComponent(c.adoProject)}" target="_blank" rel="noopener">ADO</a>` : "",
            ].filter(Boolean).join(" · ") || '<span class="empty">—</span>'}
          </td>
          <td class="row">
            <button class="btn sm" data-editclient="${esc(c.id)}">Edit</button>
            <button class="btn sm" data-openboard="${esc(c.id)}">Board</button>
          </td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
}

/* ---------------- items (flat list) view ---------------- */
function itemsViewRows() {
  const cols = columns();
  let rows = STORE.items.filter(i => {
    if (!UI.showArchived && i.archived) return false;
    if (UI.client !== "all" && i.clientId !== UI.client) return false;
    if (UI.itemsState && (i.state || cols[0]) !== UI.itemsState) return false;
    if (UI.itemsPriority && String(i.priority ?? "") !== UI.itemsPriority) return false;
    return matches(i);
  });
  const { key, dir } = UI.sort;
  const val = i => {
    switch (key) {
      case "client": return (clientById(i.clientId) || {}).name || "";
      case "state": return cols.indexOf(i.state);
      case "priority": return Number(i.priority) || 99;
      case "owner": return i.assignedTo || "\uffff";
      case "clientOwner": return i.clientOwner || "\uffff";
      case "due": return i.dueDate || "\uffff";
      case "changed": return i.changed || "";
      default: return (i.title || "").toLowerCase();
    }
  };
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
  });
  return rows;
}

function renderItems() {
  const rows = itemsViewRows();
  const cols = columns();
  const sel = UI.selected;
  const th = (key, label) =>
    `<th class="sortable" data-sort="${key}">${label}${UI.sort.key === key ? (UI.sort.dir === "asc" ? " ▲" : " ▼") : ""}</th>`;
  const allChecked = rows.length && rows.every(r => sel.has(r.id));

  $("#main").innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0;font-size:15px">All work items</h2>
      <span class="sub">${rows.length} shown of ${STORE.items.length}</span>
      <span class="spacer grow"></span>
      <select id="iClient">
        <option value="all">All clients</option>
        ${STORE.clients.filter(c => !c.archived).map(c =>
          `<option value="${esc(c.id)}" ${UI.client === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <select id="iState">
        <option value="">All statuses</option>
        ${cols.map(c => `<option ${UI.itemsState === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
      <select id="iPriority">
        <option value="">All priorities</option>
        ${(STORE.settings.priorities || []).map(p =>
          `<option value="${p}" ${UI.itemsPriority === String(p) ? "selected" : ""}>P${p}</option>`).join("")}
      </select>
      <span class="chip ${UI.showArchived ? "on" : ""}" id="iArchived">Show archived</span>
    </div>

    <div class="bulkbar ${sel.size ? "on" : ""}">
      <strong>${sel.size}</strong> selected
      <span class="spacer grow"></span>
      <button class="btn sm" data-bulk="archive">Archive</button>
      <button class="btn sm" data-bulk="unarchive">Unarchive</button>
      <button class="btn sm danger" data-bulk="delete">Delete</button>
      <button class="btn sm" id="bulkClear">Clear</button>
    </div>

    <table class="items">
      <thead><tr>
        <th style="width:32px"><input type="checkbox" id="selAll" ${allChecked ? "checked" : ""}></th>
        ${th("client", "Client")}
        ${th("title", "Item")}
        ${th("state", "Status")}
        ${th("priority", "P")}
        ${th("owner", "MS owner")}
        ${th("clientOwner", "Client owner")}
        <th>Escalation</th>
        ${th("due", "Due")}
        ${th("changed", "Updated")}
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map(i => {
          const c = clientById(i.clientId) || {};
          const color = STATE_COLOR[i.state] || "var(--cp-border-strong)";
          return `<tr class="${sel.has(i.id) ? "sel" : ""} ${i.archived ? "arch" : ""}" data-row="${esc(i.id)}">
            <td><input type="checkbox" class="rowchk" data-id="${esc(i.id)}" ${sel.has(i.id) ? "checked" : ""}></td>
            <td>${esc(c.name || "—")}</td>
            <td>
              <a href="#" class="open-item" data-id="${esc(i.id)}">${esc(i.title)}</a>
              <div class="sub">${esc(i.type || "")}${i.source === "ado" ? ` · <span class="badge-ado">ADO ${esc(i.adoId)}</span>` : ""}${i.archived ? ' · <span class="pill">archived</span>' : ""}</div>
            </td>
            <td><span class="dot" style="background:${color}"></span> ${esc(i.state)}</td>
            <td class="num">${i.priority ? "P" + esc(i.priority) : "—"}</td>
            <td>${esc(i.assignedTo || "—")}</td>
            <td class="client-owner">${esc(i.clientOwner || "—")}</td>
            <td>${escalationChip(i)} ${cssChip(i)}</td>
            <td>${i.dueDate ? fmtDate(i.dueDate) : "—"}</td>
            <td class="sub">${fmtDate(i.changed)}</td>
          </tr>`;
        }).join("") : `<tr><td colspan="10" class="empty">No items match these filters.</td></tr>`}
      </tbody>
    </table>`;
}

async function bulkAction(action) {
  const ids = [...UI.selected];
  if (!ids.length) return;
  if (action === "delete") {
    const adoCount = STORE.items.filter(i => ids.includes(i.id) && i.source === "ado").length;
    const warn = adoCount ? `\n\n${adoCount} of these are synced from Azure DevOps and will reappear on the next sync.` : "";
    if (!confirm(`Delete ${ids.length} item(s)? This cannot be undone.${warn}`)) return;
  }
  try {
    const r = await api("/api/items/bulk", "POST", { ids, action });
    UI.selected.clear();
    await reload();
    toast(`${action === "delete" ? "Deleted" : action === "archive" ? "Archived" : "Unarchived"} ${r.affected} item(s)`);
  } catch (e) { toast(e.message, true); }
}

/* ---------------- dashboard ---------------- */
const DAY = 86400000;

function dashItems() {
  return STORE.items.filter(i => {
    if (i.archived) return false;
    if (UI.client !== "all" && i.clientId !== UI.client) return false;
    if (UI.dashState && (i.state || "") !== UI.dashState) return false;
    return true;
  });
}

function bucketize(items, days) {
  const size = days <= 30 ? 1 : 7;                 // daily up to 30d, weekly beyond
  const count = Math.ceil(days / size);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const buckets = [];
  for (let b = count - 1; b >= 0; b--) {
    const to = new Date(end.getTime() - b * size * DAY);
    const from = new Date(to.getTime() - size * DAY + 1);
    buckets.push({ from, to, created: 0, closed: 0 });
  }
  const start = buckets[0].from.getTime();
  for (const it of items) {
    const c = it.created ? new Date(it.created).getTime() : NaN;
    if (!isNaN(c) && c >= start) {
      const b = buckets.find(x => c >= x.from.getTime() && c <= x.to.getTime());
      if (b) b.created++;
    }
    if (isClosed(it.state)) {
      const ch = it.changed ? new Date(it.changed).getTime() : NaN;
      if (!isNaN(ch) && ch >= start) {
        const b = buckets.find(x => ch >= x.from.getTime() && ch <= x.to.getTime());
        if (b) b.closed++;
      }
    }
  }
  // cumulative total items in existence at the end of each bucket
  let running = items.filter(i => {
    const c = i.created ? new Date(i.created).getTime() : NaN;
    return !isNaN(c) && c < start;
  }).length;
  for (const b of buckets) { running += b.created; b.total = running; }
  return { buckets, size };
}

function trendChart(items, days) {
  const { buckets, size } = bucketize(items, days);
  const W = 900, H = 260, PL = 46, PR = 46, PT = 18, PB = 34;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxBar = Math.max(1, ...buckets.map(b => Math.max(b.created, b.closed)));
  const maxTot = Math.max(1, ...buckets.map(b => b.total));
  const bw = iw / buckets.length;
  const x = i => PL + i * bw;
  const yBar = v => PT + ih - (v / maxBar) * ih;
  const yTot = v => PT + ih - (v / maxTot) * ih;
  const label = b => size === 1
    ? b.to.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : `${b.from.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = PT + ih - f * ih;
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" class="grid"/>
            <text x="${PL - 8}" y="${y + 4}" class="axis" text-anchor="end">${Math.round(maxBar * f)}</text>`;
  }).join("");

  const bars = buckets.map((b, i) => {
    const w = Math.max(2, bw * 0.34);
    const t = `${label(b)}: ${b.created} new, ${b.closed} closed, ${b.total} total`;
    return `<g><title>${esc(t)}</title>
      <rect x="${x(i) + bw / 2 - w - 1}" y="${yBar(b.created)}" width="${w}" height="${Math.max(0, PT + ih - yBar(b.created))}" class="bar-new"/>
      <rect x="${x(i) + bw / 2 + 1}" y="${yBar(b.closed)}" width="${w}" height="${Math.max(0, PT + ih - yBar(b.closed))}" class="bar-closed"/>
    </g>`;
  }).join("");

  const pts = buckets.map((b, i) => `${x(i) + bw / 2},${yTot(b.total)}`).join(" ");
  const area = `${PL},${PT + ih} ${pts} ${W - PR},${PT + ih}`;

  const step = Math.ceil(buckets.length / 12);
  const xlabels = buckets.map((b, i) => i % step === 0
    ? `<text x="${x(i) + bw / 2}" y="${H - 12}" class="axis" text-anchor="middle">${esc(label(b))}</text>` : "").join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">
    ${gridY}${bars}
    <polygon points="${area}" class="area"/>
    <polyline points="${pts}" class="line"/>
    ${buckets.map((b, i) => `<circle cx="${x(i) + bw / 2}" cy="${yTot(b.total)}" r="2.5" class="dot-t"><title>${esc(label(b))}: ${b.total} total</title></circle>`).join("")}
    ${xlabels}
    <text x="${W - PR + 8}" y="${PT + 4}" class="axis">${maxTot}</text>
    <text x="${W - PR + 8}" y="${PT + ih + 4}" class="axis">0</text>
  </svg>`;
}

function donut(slices) {
  const total = slices.reduce((s, x) => s + x.v, 0) || 1;
  const R = 60, r = 38, cx = 80, cy = 80;
  let a0 = -Math.PI / 2;
  const arcs = slices.filter(s => s.v).map(s => {
    const a1 = a0 + (s.v / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    const d = `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${s.c}" opacity="0.9"><title>${esc(s.k)}: ${s.v}</title></path>`;
  }).join("");
  return `<div class="row" style="gap:18px;align-items:center">
    <svg viewBox="0 0 160 160" class="donut">${arcs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-num">${total}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="axis">items</text></svg>
    <div class="legend">${slices.filter(s => s.v).map(s =>
      `<div><span class="sw" style="background:${s.c}"></span>${esc(s.k)} <strong>${s.v}</strong></div>`).join("")}</div>
  </div>`;
}

function barList(rows, color) {
  const max = Math.max(1, ...rows.map(r => r.v));
  if (!rows.length) return '<div class="empty">No data.</div>';
  return `<div class="barlist">${rows.map(r => `
    <div class="barrow" title="${esc(r.k)}: ${r.v}">
      <span class="barlabel">${esc(r.k)}</span>
      <span class="bartrack"><span class="barfill" style="width:${(r.v / max) * 100}%;background:${color}"></span></span>
      <span class="barval">${r.v}</span>
    </div>`).join("")}</div>`;
}

function renderDashboard() {
  const items = dashItems();
  const days = UI.dashDays;
  const since = Date.now() - days * DAY;
  const inWindow = items.filter(i => i.created && new Date(i.created).getTime() >= since);
  const closedInWindow = items.filter(i => isClosed(i.state) && i.changed && new Date(i.changed).getTime() >= since);
  const open = items.filter(i => !isClosed(i.state));
  const overdue = open.filter(i => i.dueDate && daysUntil(i.dueDate) !== null && daysUntil(i.dueDate) < 0);
  const meetings = items.filter(i => i.meetingStatus && i.meetingStatus !== "N/A");
  const tbr = items.filter(i => i.meetingStatus === "TBR");
  const escalated = items.filter(isEscalated);
  const cssCases = items.filter(i => i.cssCase);
  const dcrs = items.filter(i => i.dcr || i.dcrStatus);
  const unowned = open.filter(i => !i.clientOwner);
  const ages = open.map(i => i.created ? (Date.now() - new Date(i.created).getTime()) / DAY : null).filter(v => v !== null);
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;

  const byState = columns().map(c => ({
    k: c, v: items.filter(i => (i.state || columns()[0]) === c).length, c: STATE_COLOR[c] || "var(--cp-border-strong)"
  }));
  const byClient = STORE.clients.filter(c => !c.archived)
    .map(c => ({ k: c.name, v: open.filter(i => i.clientId === c.id).length }))
    .filter(r => r.v).sort((a, b) => b.v - a.v);
  const byClientOwner = [...new Set(open.map(i => i.clientOwner || "— unassigned —"))]
    .map(k => ({ k, v: open.filter(i => (i.clientOwner || "— unassigned —") === k).length }))
    .sort((a, b) => b.v - a.v);
  const byMsOwner = [...new Set(open.map(i => i.assignedTo || "— unassigned —"))]
    .map(k => ({ k, v: open.filter(i => (i.assignedTo || "— unassigned —") === k).length }))
    .sort((a, b) => b.v - a.v);
  const byType = [...new Set(items.map(i => i.type).filter(Boolean))]
    .map(k => ({ k, v: items.filter(i => i.type === k).length })).sort((a, b) => b.v - a.v);

  const tile = (label, value, sub, cls) =>
    `<div class="tile ${cls || ""}"><div class="tile-v">${value}</div><div class="tile-l">${esc(label)}</div>${sub ? `<div class="tile-s">${esc(sub)}</div>` : ""}</div>`;

  $("#main").innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <h2 style="margin:0;font-size:15px">Dashboard</h2>
      <span class="sub">${UI.client === "all" ? "whole portfolio" : esc((clientById(UI.client) || {}).name || "")}</span>
      <span class="spacer grow"></span>
      <select id="dashClientSel">
        <option value="all">All clients</option>
        ${STORE.clients.filter(c => !c.archived).map(c =>
          `<option value="${esc(c.id)}" ${UI.client === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <select id="dashStateSel">
        <option value="">All statuses</option>
        ${columns().map(c => `<option ${UI.dashState === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
    </div>

    <div class="row" style="margin-bottom:14px">
      <span class="sub">Window:</span>
      ${[7, 15, 30, 90, 120, 180].map(d =>
        `<span class="chip ${days === d ? "on" : ""}" data-days="${d}">${d}d</span>`).join("")}
    </div>

    <div class="tiles">
      ${tile("New items", inWindow.length, `last ${days} days`, "accent")}
      ${tile("Closed", closedInWindow.length, `last ${days} days`, "ok")}
      ${tile("Open now", open.length, `${items.length} total`)}
      ${tile("Avg age", avgAge + "d", "open items")}
      ${tile("Escalated", escalated.length, `${dcrs.length} DCR · ${cssCases.length} CSS`, escalated.length ? "warn" : "")}
      ${tile("Overdue", overdue.length, "past due date", overdue.length ? "bad" : "")}
      ${tile("To reschedule", tbr.length, `${meetings.length} meeting(s) tracked`, tbr.length ? "bad" : "")}
      ${tile("No client owner", unowned.length, "open items", unowned.length ? "warn" : "")}
    </div>

    <div class="card-panel">
      <h3>New vs closed — last ${days} days <span class="sub">(${days <= 30 ? "daily" : "weekly"} buckets; line = cumulative total)</span></h3>
      <div class="row legend inline">
        <div><span class="sw" style="background:var(--cp-accent)"></span>New</div>
        <div><span class="sw" style="background:var(--cp-success)"></span>Closed</div>
        <div><span class="sw line-sw"></span>Cumulative total</div>
      </div>
      ${trendChart(items, days)}
    </div>

    <div class="grid2">
      <div class="card-panel"><h3>Status distribution</h3>${donut(byState)}</div>
      <div class="card-panel"><h3>Work item types</h3>${barList(byType, "var(--cp-link)")}</div>
      <div class="card-panel"><h3>Open items by client</h3>${barList(byClient, "var(--cp-accent)")}</div>
      <div class="card-panel"><h3>Open items by client owner</h3>${barList(byClientOwner, "var(--cp-link)")}</div>
      <div class="card-panel"><h3>Open items by MS owner</h3>${barList(byMsOwner, "var(--cp-warning)")}</div>
      <div class="card-panel"><h3>Meeting pipeline</h3>
        ${barList((STORE.settings.meetingStatuses || [])
          .map(s => ({ k: s, v: items.filter(i => i.meetingStatus === s).length }))
          .filter(r => r.v), "var(--cp-link)")}
      </div>
      <div class="card-panel"><h3>Escalations <span class="sub">(escalated to, or DCR raised)</span></h3>
        ${escalated.length ? `
          ${donut([
            { k: "Field only (PM/PG/CSAM)", v: items.filter(i => ((i.escalatedTo || []).length || i.escalationStatus) && !(i.dcr || i.dcrStatus)).length, c: "var(--cp-accent)" },
            { k: "DCR only", v: items.filter(i => (i.dcr || i.dcrStatus) && !((i.escalatedTo || []).length || i.escalationStatus)).length, c: "var(--cp-warning)" },
            { k: "Both", v: items.filter(i => ((i.escalatedTo || []).length || i.escalationStatus) && (i.dcr || i.dcrStatus)).length, c: "var(--cp-danger)" },
          ])}
          <h4 class="sec" style="margin-top:14px">Breakdown</h4>
          ${barList((STORE.settings.escalationTargets || []).map(t =>
            ({ k: "to " + t, v: items.filter(i => (i.escalatedTo || []).includes(t)).length }))
            .concat((STORE.settings.escalationStatuses || []).map(s =>
              ({ k: "escalation: " + s, v: items.filter(i => i.escalationStatus === s).length })))
            .concat((STORE.settings.dcrStatuses || []).map(s =>
              ({ k: "DCR: " + s, v: items.filter(i => i.dcrStatus === s).length })))
            .concat([{ k: "CSS case open", v: cssCases.length }])
            .filter(r => r.v), "var(--cp-warning)")}`
        : '<div class="empty">Nothing escalated in this view.</div>'}
      </div>
    </div>
    <p class="sub" style="margin-top:14px">Closed counts use each item's last-updated date as a proxy — the store keeps no state-change history.</p>`;
}

/* ---------------- proposals review ---------------- */
let PROPOSALS = { proposals: [], counts: {} };

async function loadProposals() {
  try {
    PROPOSALS = await api("/api/proposals?status=pending");
  } catch { PROPOSALS = { proposals: [], counts: {} }; }
  const n = PROPOSALS.proposals.length;
  const badge = $("#propBadge");
  if (badge) { badge.textContent = n || ""; badge.classList.toggle("on", !!n); }
}

const FIELD_LABELS = {
  title: "Title", type: "Type", state: "State", priority: "Priority",
  assignedTo: "MS owner", clientOwner: "Client owner", dueDate: "Due date",
  meetingStatus: "Meeting status", escalationStatus: "Escalation status",
  cssCaseNumber: "CSS case", dcrId: "DCR", dcrStatus: "DCR status",
  tags: "Tags", description: "Description", acceptance: "Acceptance",
};

function fieldRows(cur, prop) {
  const keys = [...new Set([...Object.keys(FIELD_LABELS)])];
  return keys.map(k => {
    const a = cur ? cur[k] : undefined;
    const b = prop ? prop[k] : undefined;
    const fmt = v => Array.isArray(v) ? v.join(", ") : (v === true ? "Yes" : v === false ? "" : (v ?? ""));
    const av = fmt(a), bv = fmt(b);
    if (!av && !bv) return "";
    const diff = String(av).trim() !== String(bv).trim();
    return `<tr class="${diff ? "diff" : ""}">
      <th>${esc(FIELD_LABELS[k])}</th>
      <td>${esc(av) || '<span class="empty">—</span>'}</td>
      <td>${esc(bv) || '<span class="empty">—</span>'}</td>
    </tr>`;
  }).join("");
}

function renderProposals() {
  const list = PROPOSALS.proposals;
  const byClient = {};
  list.forEach(p => { (byClient[p.clientName || p.clientId] ||= []).push(p); });
  const names = Object.keys(byClient).sort();

  $("#main").innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <h2 style="margin:0;font-size:15px">Proposals</h2>
      <span class="sub">${list.length} pending${list.length ? ` · ${names.length} client(s)` : ""}</span>
      <span class="spacer grow"></span>
      ${list.length ? `<button class="btn" data-pdecide="skip" data-scope="all">Skip all</button>
      <button class="btn primary" data-pdecide="accept" data-scope="all">Accept all</button>` : ""}
    </div>
    ${!list.length ? `<div class="card-panel"><div class="empty">
      No pending proposals. The daily scan runs weekday mornings and posts here;
      you can also trigger it from chat.</div></div>` : ""}
    ${names.map(name => {
      const ps = byClient[name];
      return `<section class="client" style="margin-bottom:18px">
        <div class="client-head" style="border-radius:16px 16px 0 0">
          <h2>${esc(name)}</h2>
          <span class="pill accent">${ps.length} proposal(s)</span>
          <span class="spacer grow"></span>
          <button class="btn sm" data-pdecide="skip" data-client="${esc(ps[0].clientId)}">Skip all</button>
          <button class="btn sm primary" data-pdecide="accept" data-client="${esc(ps[0].clientId)}">Accept all</button>
        </div>
        <div class="card-panel" style="border-radius:0 0 16px 16px;border-top:none">
          ${ps.map(proposalCard).join("")}
        </div>
      </section>`;
    }).join("")}`;
}

function proposalCard(p) {
  const cur = p.match;
  const prop = p.kind === "add" ? (p.item || {}) : Object.assign({}, cur || {}, p.patch || {});
  const dupe = p.kind === "add" && cur;
  return `<div class="prop ${dupe ? "dupe" : ""}" data-pid="${esc(p.id)}">
    <div class="prop-head">
      <span class="pill ${p.kind === "add" ? "accent" : ""}">${esc(p.kind)}</span>
      <span class="pill ${p.evidence === "evidenced" ? "ok" : "warn"}">${esc(p.evidence || "")}</span>
      ${p.source ? `<span class="sub">${esc(p.source)}</span>` : ""}
      ${dupe ? `<span class="pill bad" title="A similar item already exists on this board">possible duplicate · ${Math.round((p.matchScore || 0) * 100)}% match</span>` : ""}
      <span class="spacer grow"></span>
      <button class="btn sm" data-pdecide="skip" data-pid="${esc(p.id)}">Skip</button>
      <button class="btn sm primary" data-pdecide="accept" data-pid="${esc(p.id)}">${p.kind === "add" ? "Add" : "Apply"}</button>
      ${cur ? `<button class="btn sm" data-pdecide="archive" data-pid="${esc(p.id)}" title="Archive the current item and discard this proposal">Archive current</button>
               <button class="btn sm danger" data-pdecide="delete" data-pid="${esc(p.id)}" title="Delete the current item and discard this proposal">Delete current</button>` : ""}
    </div>
    ${p.note ? `<div class="sub" style="margin:4px 0 8px">${esc(p.note)}</div>` : ""}
    <table class="compare">
      <thead><tr><th style="width:130px"></th>
        <th>Current item ${cur ? "" : '<span class="sub">(none — new)</span>'}</th>
        <th>Proposed</th></tr></thead>
      <tbody>${fieldRows(cur, prop)}</tbody>
    </table>
  </div>`;
}

async function decideProposals(action, ids) {
  if (!ids.length) return;
  const verb = { accept: "Apply", skip: "Skip", archive: "Archive the current item for",
                 delete: "DELETE the current item for" }[action];
  if (action !== "accept" && action !== "skip") {
    if (!confirm(`${verb} ${ids.length} proposal(s)?`)) return;
  } else if (ids.length > 1 && !confirm(`${verb} ${ids.length} proposal(s)?`)) return;
  try {
    const r = await api("/api/proposals/decide", "POST", { ids, action });
    const bad = (r.results || []).filter(x => !x.ok);
    await loadProposals();
    await reload();
    toast(`${action} · ${r.affected} done${bad.length ? ` · ${bad.length} failed` : ""}`, !!bad.length);
    if (bad.length) console.warn("proposal failures", bad);
  } catch (e) { toast(e.message, true); }
}

/* ---------------- item drawer ---------------- */
function openItem(id) {
  const it = STORE.items.find(i => i.id === id);
  if (!it) return;
  const c = clientById(it.clientId) || {};
  const ado = it.source === "ado";
  const row = (k, v) => v || v === 0 ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : "";
  const opts = (arr, cur) => arr.map(o =>
    `<option ${String(o) === String(cur) ? "selected" : ""}>${esc(o)}</option>`).join("");

  $("#drawer").innerHTML = `
    <div class="drawer-head">
      <div class="grow">
        <div class="sub">${esc((it.type || "item").toUpperCase())} · ${esc(c.name || "")}
          ${ado ? `<span class="badge-ado">ADO ${esc(it.adoId || "")}</span>` : ""}</div>
        <h3>${esc(it.title)}</h3>
      </div>
      <button class="btn" id="closeDrawer">✕</button>
    </div>
    ${ado ? '<div class="pill warn" style="margin:6px 0 0;display:inline-block">Synced from Azure DevOps — edit in ADO (state &amp; tags editable here)</div>' : ""}
    <dl class="kv">
      <dt>State</dt><dd><select id="dState">${opts(columns(), it.state)}</select></dd>
      <dt>MS owner</dt><dd><input id="dOwner" value="${esc(it.assignedTo || "")}" placeholder="Unassigned" ${ado ? "disabled" : ""}></dd>
      <dt>Client owner</dt><dd><input id="dClientOwner" list="clientLeads" value="${esc(it.clientOwner || "")}"
        placeholder="${esc(c.clientLead || "Who leads this on the client side")}"></dd>
      <dt>Type</dt><dd><select id="dType" ${ado ? "disabled" : ""}>${opts(STORE.settings.types || [], it.type)}</select></dd>
      <dt>Priority</dt><dd><select id="dPriority" ${ado ? "disabled" : ""}><option value=""></option>${opts(STORE.settings.priorities || [], it.priority)}</select></dd>
      <dt>Story points</dt><dd><input id="dPoints" value="${esc(it.storyPoints ?? "")}" ${ado ? "disabled" : ""}></dd>
      <dt>Risk</dt><dd><select id="dRisk" ${ado ? "disabled" : ""}><option value=""></option>${opts(STORE.settings.riskLevels || [], it.risk)}</select></dd>
      <dt>Value area</dt><dd><select id="dValue" ${ado ? "disabled" : ""}><option value=""></option>${opts(STORE.settings.valueAreas || [], it.valueArea)}</select></dd>
      <dt>Due date</dt><dd><input type="date" id="dDue" value="${esc((it.dueDate || "").slice(0, 10))}" ${ado ? "disabled" : ""}></dd>
      <dt>Meeting status</dt><dd><select id="dMeeting"><option value=""></option>${opts(STORE.settings.meetingStatuses || [], it.meetingStatus)}</select></dd>
      <dt>Tags</dt><dd><input id="dTags" value="${esc((it.tags || []).join(", "))}" placeholder="comma separated"></dd>
      <dt>Escalated to</dt><dd class="row">${(STORE.settings.escalationTargets || []).map(t => `
        <label class="check"><input type="checkbox" class="dEsc" value="${esc(t)}"
          ${(it.escalatedTo || []).includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")}</dd>
      <dt>Escalation status</dt><dd><select id="dEscStatus"><option value=""></option>${opts(STORE.settings.escalationStatuses || [], it.escalationStatus)}</select></dd>
      <dt>CSS case</dt><dd class="row">
        <label class="check"><input type="checkbox" id="dCss" ${it.cssCase ? "checked" : ""}> Yes</label>
        <input id="dCssNum" class="grow" value="${esc(it.cssCaseNumber || "")}" placeholder="Case / tracking ID (optional)">
      </dd>
      <dt>DCR</dt><dd class="row">
        <label class="check"><input type="checkbox" id="dDcr" ${it.dcr ? "checked" : ""}> Yes</label>
        <input id="dDcrId" class="grow" value="${esc(it.dcrId || "")}" placeholder="DCR tracking ID (optional)">
      </dd>
      <dt>DCR status</dt><dd><select id="dDcrStatus"><option value=""></option>${opts(STORE.settings.dcrStatuses || [], it.dcrStatus)}</select></dd>
      ${row("Created", `${fmtDate(it.created)}${it.createdBy ? " by " + esc(it.createdBy) : ""}`)}
      ${row("Updated", fmtDate(it.changed))}
    </dl>
    <h4 class="sec">Description</h4>
    ${ado
      ? `<div class="rich">${it.description || '<span class="empty">No description.</span>'}</div>`
      : `<textarea id="dDesc" placeholder="What needs to happen…">${esc(it.description || "")}</textarea>`}
    <h4 class="sec">Acceptance criteria</h4>
    ${ado
      ? `<div class="rich">${it.acceptance || '<span class="empty">None.</span>'}</div>`
      : `<textarea id="dAcc" placeholder="Definition of done…">${esc(it.acceptance || "")}</textarea>`}
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="dSave">Save changes</button>
      ${it.adoUrl ? `<a class="btn" href="${esc(it.adoUrl)}" target="_blank" rel="noopener">Open in Azure DevOps ↗</a>` : ""}
      <span class="spacer grow"></span>
      <button class="btn danger" id="dDelete">Delete</button>
    </div>
    <h4 class="sec">Discussion (${(it.comments || []).length})</h4>
    <div class="row" style="margin-bottom:10px">
      <input class="grow" id="dComment" placeholder="Add a comment…">
      <button class="btn" id="dCommentBtn">Post</button>
    </div>
    ${(it.comments || []).slice().reverse().map(cm => `
      <div class="comment">
        <span class="who">${esc(cm.by)}</span><span class="when">${fmtDate(cm.date)}</span>
        <div class="rich">${cm.html ? cm.text : esc(cm.text)}</div>
      </div>`).join("") || '<div class="empty">No comments yet.</div>'}`;

  $("#drawer").classList.add("on");
  $("#scrim").classList.add("on");
  $("#closeDrawer").onclick = closeOverlays;

  $("#dSave").onclick = async () => {
    const patch = {
      state: $("#dState").value,
      clientOwner: $("#dClientOwner").value.trim(),
      meetingStatus: $("#dMeeting").value,
      escalatedTo: [...document.querySelectorAll(".dEsc:checked")].map(c => c.value),
      escalationStatus: $("#dEscStatus").value,
      cssCase: $("#dCss").checked,
      cssCaseNumber: $("#dCssNum").value.trim(),
      dcr: $("#dDcr").checked,
      dcrId: $("#dDcrId").value.trim(),
      dcrStatus: $("#dDcrStatus").value,
      tags: $("#dTags").value.split(",").map(t => t.trim()).filter(Boolean),
    };
    if (!ado) Object.assign(patch, {
      assignedTo: $("#dOwner").value.trim(),
      type: $("#dType").value,
      priority: $("#dPriority").value,
      storyPoints: $("#dPoints").value,
      risk: $("#dRisk").value,
      valueArea: $("#dValue").value,
      dueDate: $("#dDue").value,
      description: $("#dDesc").value,
      acceptance: $("#dAcc").value,
    });
    try {
      await api(`/api/items/${it.id}`, "PUT", patch);
      await reload();
      openItem(it.id);
      toast("Saved");
    } catch (e) { toast(e.message, true); }
  };

  $("#dDelete").onclick = async () => {
    if (!confirm(`Delete "${it.title}"?`)) return;
    try {
      await api(`/api/items/${it.id}`, "DELETE");
      closeOverlays();
      await reload();
      toast("Deleted");
    } catch (e) { toast(e.message, true); }
  };

  const post = async () => {
    const text = $("#dComment").value.trim();
    if (!text) return;
    try {
      await api(`/api/items/${it.id}/comments`, "POST", { text });
      await reload();
      openItem(it.id);
    } catch (e) { toast(e.message, true); }
  };
  $("#dCommentBtn").onclick = post;
  $("#dComment").onkeydown = e => { if (e.key === "Enter") post(); };
}

function closeOverlays() {
  $("#drawer").classList.remove("on");
  $("#scrim").classList.remove("on");
  $("#modalWrap").classList.remove("on");
}

/* ---------------- modals ---------------- */
function newItemModal(clientId, state) {
  const cid = clientId || (UI.client !== "all" ? UI.client : (STORE.clients[0] || {}).id);
  const opts = (arr, cur) => arr.map(o => `<option ${String(o) === String(cur) ? "selected" : ""}>${esc(o)}</option>`).join("");
  $("#modal").innerHTML = `
    <h3>New work item</h3>
    <div class="form-grid">
      <label class="full">Title<input id="nTitle" placeholder="Short, action-oriented title"></label>
      <label>Client<select id="nClient">${STORE.clients.filter(c => !c.archived)
        .map(c => `<option value="${esc(c.id)}" ${c.id === cid ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label>Type<select id="nType">${opts(STORE.settings.types || [], "User Story")}</select></label>
      <label>State<select id="nState">${opts(columns(), state || columns()[0])}</select></label>
      <label>MS owner<input id="nOwner" placeholder="Who owns it at Microsoft"></label>
      <label>Client owner<input id="nClientOwner" list="clientLeads" placeholder="Client-side lead"></label>
      <label>Priority<select id="nPriority"><option value=""></option>${opts(STORE.settings.priorities || [], 2)}</select></label>
      <label>Due date<input type="date" id="nDue"></label>
      <label>Meeting status<select id="nMeeting"><option value=""></option>${opts(STORE.settings.meetingStatuses || [], "")}</select></label>
      <label class="full">Tags<input id="nTags" placeholder="comma separated"></label>
      <label class="full">Escalated to<span class="row" style="margin-top:2px">${(STORE.settings.escalationTargets || []).map(t => `
        <label class="check"><input type="checkbox" class="nEsc" value="${esc(t)}"> ${esc(t)}</label>`).join("")}
        <select id="nEscStatus" style="margin-left:8px"><option value="">no escalation status</option>${opts(STORE.settings.escalationStatuses || [], "")}</select>
      </span></label>
      <label class="full">CSS case<span class="row" style="margin-top:2px">
        <label class="check"><input type="checkbox" id="nCss"> Yes</label>
        <input id="nCssNum" class="grow" placeholder="Case / tracking ID (optional)">
      </span></label>
      <label class="full">DCR<span class="row" style="margin-top:2px">
        <label class="check"><input type="checkbox" id="nDcr"> Yes</label>
        <input id="nDcrId" class="grow" placeholder="DCR tracking ID (optional)">
        <select id="nDcrStatus" style="margin-left:8px"><option value="">no DCR status</option>${opts(STORE.settings.dcrStatuses || [], "")}</select>
      </span></label>
      <label class="full">Description<textarea id="nDesc"></textarea></label>
      <label class="full">Acceptance criteria<textarea id="nAcc"></textarea></label>
    </div>
    <div class="form-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="nSave">Create</button>
    </div>`;
  $("#modalWrap").classList.add("on");
  $("#nTitle").focus();
  const syncLead = () => {
    const sel = clientById($("#nClient").value);
    $("#nClientOwner").placeholder = (sel && sel.clientLead) || "Client-side lead";
    $("#nClientOwner").value = (sel && sel.clientLead) || "";
  };
  syncLead();
  $("#nClient").onchange = syncLead;
  $("#nSave").onclick = async () => {
    const payload = {
      title: $("#nTitle").value.trim(),
      clientId: $("#nClient").value,
      type: $("#nType").value,
      state: $("#nState").value,
      assignedTo: $("#nOwner").value.trim(),
      clientOwner: $("#nClientOwner").value.trim(),
      priority: $("#nPriority").value,
      dueDate: $("#nDue").value,
      meetingStatus: $("#nMeeting").value,
      tags: $("#nTags").value.split(",").map(t => t.trim()).filter(Boolean),
      escalatedTo: [...document.querySelectorAll(".nEsc:checked")].map(c => c.value),
      escalationStatus: $("#nEscStatus").value,
      cssCase: $("#nCss").checked,
      cssCaseNumber: $("#nCssNum").value.trim(),
      dcr: $("#nDcr").checked,
      dcrId: $("#nDcrId").value.trim(),
      dcrStatus: $("#nDcrStatus").value,
      description: $("#nDesc").value,
      acceptance: $("#nAcc").value,
    };
    if (!payload.title) return toast("Title is required", true);
    try {
      await api("/api/items", "POST", payload);
      closeOverlays();
      await reload();
      toast("Work item created");
    } catch (e) { toast(e.message, true); }
  };
}

function clientModal(id) {
  const c = id ? clientById(id) : null;
  const v = k => esc(c ? (c[k] ?? "") : "");
  $("#modal").innerHTML = `
    <h3>${c ? "Edit client" : "Add client"}</h3>
    <div class="form-grid">
      <label class="full">Customer name<input id="cName" value="${v("name")}"></label>
      <label>Package name<input id="cPackage" value="${v("packageName")}"></label>
      <label>Package ID<input id="cPackageId" value="${v("packageId")}"></label>
      <label>Status<select id="cStatus">
        ${["pending", "active", "completed", "on hold", "closed"].map(s =>
          `<option ${c && c.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select></label>
      <label>Contract end<input type="date" id="cEnd" value="${v("contractEnd").slice(0, 10)}"></label>
      <label class="full">Know-Me link<input id="cKnowMe" value="${v("knowMeUrl")}" placeholder="https://…"></label>
      <label>Client-side lead<input id="cLead" value="${v("clientLead")}" placeholder="Full name"></label>
      <label>Lead role / title<input id="cLeadRole" value="${v("clientLeadRole")}" placeholder="e.g. Head of Endpoint Services"></label>
      <label class="full">Lead email<input id="cLeadEmail" value="${v("clientLeadEmail")}" placeholder="name@customer.com"></label>
      ${c ? `<label class="full" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" id="cApplyLead" style="width:auto">
        <span>Apply this lead to work items on this board that have no client owner</span>
      </label>` : ""}
      <label>Azure DevOps org<input id="cOrg" value="${v("adoOrg")}" placeholder="SMCDevOps"></label>
      <label>Azure DevOps project<input id="cProject" value="${v("adoProject")}" placeholder="leave blank if none"></label>
      <label class="full">Search terms <span class="sub">— every alias the daily scan searches: legal names, email domains, DL aliases</span>
        <input id="cTerms" value="${v("searchTerms")}" placeholder="Contoso, contoso.com, Contoso Holdings LLC"></label>
      <label class="full" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" id="cScan" style="width:auto" ${!c || c.scanEnabled ? "checked" : ""}>
        <span>Include in the daily email/Teams scan</span>
        ${c && !c.lastScan ? '<span class="pill warn">never scanned</span>' : ""}
        ${c && c.scanRequested ? '<span class="pill accent">queued for next scan</span>' : ""}
      </label>
      <label class="full">Notes<textarea id="cNotes">${v("notes")}</textarea></label>
    </div>
    <div class="form-actions">
      ${c ? '<button class="btn danger" id="cDelete">Delete client</button>' : ""}
      ${c ? '<button class="btn" id="cScanNow">⟳ Scan now</button>' : ""}
      <span class="spacer grow"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="cSave">${c ? "Save" : "Create"}</button>
    </div>`;
  $("#modalWrap").classList.add("on");
  $("#cSave").onclick = async () => {
    const payload = {
      name: $("#cName").value.trim(),
      packageName: $("#cPackage").value.trim(),
      packageId: $("#cPackageId").value.trim(),
      status: $("#cStatus").value,
      contractEnd: $("#cEnd").value,
      knowMeUrl: $("#cKnowMe").value.trim(),
      clientLead: $("#cLead").value.trim(),
      clientLeadRole: $("#cLeadRole").value.trim(),
      clientLeadEmail: $("#cLeadEmail").value.trim(),
      adoOrg: $("#cOrg").value.trim(),
      adoProject: $("#cProject").value.trim(),
      searchTerms: $("#cTerms").value.trim(),
      scanEnabled: $("#cScan").checked,
      notes: $("#cNotes").value,
    };
    if (c && $("#cApplyLead") && $("#cApplyLead").checked) payload.applyLeadToItems = true;
    if (!payload.name) return toast("Customer name is required", true);
    try {
      await api(c ? `/api/clients/${c.id}` : "/api/clients", c ? "PUT" : "POST", payload);
      closeOverlays();
      await reload();
      toast(c ? "Client updated" : "Client added");
    } catch (e) { toast(e.message, true); }
  };
  if (c) $("#cDelete").onclick = async () => {
    if (!confirm(`Delete ${c.name} and all of its work items?`)) return;
    try {
      await api(`/api/clients/${c.id}`, "DELETE");
      closeOverlays();
      if (UI.client === c.id) UI.client = "all";
      await reload();
      toast("Client deleted");
    } catch (e) { toast(e.message, true); }
  };
  if (c) $("#cScanNow").onclick = async () => {
    try {
      await api("/api/scan-queue", "POST", { ids: [c.id] });
      await reload();
      toast(`${c.name} queued — the next scan will do a full first pass`);
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- drag & drop ---------------- */
let dragId = null;
function wireDnd() {
  document.querySelectorAll(".card").forEach(el => {
    el.addEventListener("dragstart", e => {
      dragId = el.dataset.id;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
    });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); dragId = null; });
  });
  document.querySelectorAll(".drop").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", async e => {
      e.preventDefault();
      zone.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain") || dragId;
      const it = STORE.items.find(i => i.id === id);
      if (!it) return;
      if (it.clientId !== zone.dataset.client) return toast("Move items within the same client", true);
      if (it.state === zone.dataset.col) return;
      try {
        await api(`/api/items/${id}`, "PUT", { state: zone.dataset.col });
        await reload();
      } catch (err) { toast(err.message, true); }
    });
  });
}

/* ---------------- render ---------------- */
function refreshFilters() {
  const people = [...new Set(STORE.items.map(i => i.assignedTo).filter(Boolean))].sort();
  const leads = [...new Set([
    ...STORE.items.map(i => i.clientOwner).filter(Boolean),
    ...STORE.clients.map(c => c.clientLead).filter(Boolean),
  ])].sort();
  const types = [...new Set(STORE.items.map(i => i.type).filter(Boolean))].sort();
  const fill = (sel, values, current, label) => {
    sel.innerHTML = `<option value="">${label}</option>` +
      values.map(v => `<option ${v === current ? "selected" : ""}>${esc(v)}</option>`).join("");
  };
  fill($("#fAssignee"), people, UI.assignee, "All MS owners");
  fill($("#fClientOwner"), leads, UI.clientOwner, "All client owners");
  $("#fClientOwner").insertAdjacentHTML("beforeend",
    `<option value="__none__" ${UI.clientOwner === "__none__" ? "selected" : ""}>— no client owner —</option>`);
  fill($("#fType"), types, UI.type, "All types");
  fill($("#fMeeting"), STORE.settings.meetingStatuses || [], UI.meeting, "All meeting statuses");
  const escSel = $("#fEscalation");
  const targets = STORE.settings.escalationTargets || [];
  const statuses = STORE.settings.escalationStatuses || [];
  const sel = v => UI.escalation === v ? "selected" : "";
  escSel.innerHTML =
    `<option value="">All escalations</option>` +
    `<option value="__any__" ${sel("__any__")}>— any escalation —</option>` +
    targets.map(t => `<option value="${esc(t)}" ${sel(t)}>to ${esc(t)}</option>`).join("") +
    statuses.map(s => `<option value="${esc(s)}" ${sel(s)}>status: ${esc(s)}</option>`).join("") +
    `<option value="__css__" ${sel("__css__")}>has CSS case</option>` +
    `<option value="__dcr__" ${sel("__dcr__")}>has DCR</option>` +
    (STORE.settings.dcrStatuses || []).map(s =>
      `<option value="dcr:${esc(s)}" ${sel("dcr:" + s)}>DCR: ${esc(s)}</option>`).join("");
  // shared autocomplete source for the client-owner inputs
  let dl = document.getElementById("clientLeads");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "clientLeads";
    document.body.appendChild(dl);
  }
  dl.innerHTML = leads.map(l => `<option value="${esc(l)}"></option>`).join("");
}

function render() {
  const openItems = STORE.items.filter(i => !i.archived && !isClosed(i.state)).length;
  const soon = STORE.clients.filter(c => {
    const d = daysUntil(c.contractEnd);
    return d !== null && d >= 0 && d <= 90;
  }).length;
  $("#meta").textContent =
    `${STORE.clients.filter(c => !c.archived).length} clients · ${openItems} open items` +
    (soon ? ` · ${soon} contract(s) ending within 90 days` : "");
  renderRail();
  refreshFilters();
  if (UI.view === "board") { renderBoard(); wireDnd(); }
  else if (UI.view === "items") renderItems();
  else if (UI.view === "dashboard") renderDashboard();
  else if (UI.view === "proposals") renderProposals();
  else renderClients();
}

/* ---------------- events ---------------- */
document.addEventListener("click", e => {
  const t = e.target;

  const pd = t.closest("[data-pdecide]");
  if (pd) {
    const action = pd.dataset.pdecide;
    let ids;
    if (pd.dataset.pid) ids = [pd.dataset.pid];
    else if (pd.dataset.client) ids = PROPOSALS.proposals.filter(p => p.clientId === pd.dataset.client).map(p => p.id);
    else ids = PROPOSALS.proposals.map(p => p.id);
    return decideProposals(action, ids);
  }

  // ---- items view interactions ----
  if (t.id === "selAll") {
    const rows = itemsViewRows();
    if (t.checked) rows.forEach(r => UI.selected.add(r.id));
    else rows.forEach(r => UI.selected.delete(r.id));
    return render();
  }
  if (t.classList && t.classList.contains("rowchk")) {
    t.checked ? UI.selected.add(t.dataset.id) : UI.selected.delete(t.dataset.id);
    return render();
  }
  const openLink = t.closest(".open-item");
  if (openLink) { e.preventDefault(); return openItem(openLink.dataset.id); }
  const bulk = t.closest("[data-bulk]");
  if (bulk) return bulkAction(bulk.dataset.bulk);
  if (t.id === "bulkClear") { UI.selected.clear(); return render(); }
  if (t.id === "iArchived") { UI.showArchived = !UI.showArchived; return render(); }
  const dayChip = t.closest("[data-days]");
  if (dayChip) { UI.dashDays = Number(dayChip.dataset.days); return render(); }
  const sortHead = t.closest("[data-sort]");
  if (sortHead) {
    const key = sortHead.dataset.sort;
    UI.sort = { key, dir: UI.sort.key === key && UI.sort.dir === "asc" ? "desc" : "asc" };
    return render();
  }

  const railBtn = t.closest("[data-client]");
  if (railBtn && railBtn.classList.contains("rail-item")) {
    setClient(railBtn.dataset.client);
    if (UI.view === "clients") UI.view = "board";
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.view === UI.view));
    return render();
  }
  if (t.id === "railAddClient" || t.id === "addClientBtn") return clientModal(null);
  if (t.id === "scanNew") {
    return api("/api/scan-queue", "POST", { scope: "new" })
      .then(async r => { await reload(); toast(`${r.queued.length} client(s) queued for a first-pass scan`); })
      .catch(e => toast(e.message, true));
  }

  const tab = t.closest(".tab");
  if (tab) {
    UI.view = tab.dataset.view;
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === tab));
    return render();
  }

  const toggle = t.closest("[data-toggle]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    UI.collapsed.has(id) ? UI.collapsed.delete(id) : UI.collapsed.add(id);
    localStorage.setItem("sfmcCollapsed", JSON.stringify([...UI.collapsed]));
    return render();
  }

  const edit = t.closest("[data-editclient]");
  if (edit) return clientModal(edit.dataset.editclient);

  const openBoard = t.closest("[data-openboard]");
  if (openBoard) {
    setClient(openBoard.dataset.openboard);
    UI.view = "board";
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.view === "board"));
    return render();
  }

  const add = t.closest("[data-add]");
  if (add) return newItemModal(add.dataset.add, add.dataset.state);
  if (t.id === "addItemBtn") return newItemModal(null, null);

  const card = t.closest(".card");
  if (card) return openItem(card.dataset.id);

  if (t.hasAttribute("data-close") || t === $("#scrim")) return closeOverlays();
  if (t === $("#modalWrap")) return closeOverlays();

  if (t.id === "themeBtn") {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sfmcTheme", next);
  }

  if (t.id === "syncBtn") {
    const linked = STORE.clients.filter(c => c.adoProject && !c.archived);
    if (!linked.length) return toast("No clients are linked to an Azure DevOps project", true);
    t.disabled = true;
    t.textContent = "Syncing…";
    toast(`Pulling Azure DevOps for ${linked.length} client(s)…`);
    api("/api/sync-ado", "POST", {})
      .then(async r => {
        await reload();
        toast((r.output || "Sync complete").split("\n").filter(Boolean).pop());
      })
      .catch(e => toast(e.message, true))
      .finally(() => { t.disabled = false; t.textContent = "⟳ Sync ADO"; });
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "iClient") { setClient(t.value); render(); }
  if (t.id === "iState") { UI.itemsState = t.value; render(); }
  if (t.id === "iPriority") { UI.itemsPriority = t.value; render(); }
  if (t.id === "dashClientSel") { setClient(t.value); render(); }
  if (t.id === "dashStateSel") { UI.dashState = t.value; render(); }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeOverlays();
  if (e.key === "n" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); newItemModal(null, null); }
});

$("#q").addEventListener("input", e => { UI.q = e.target.value; render(); });
$("#fAssignee").addEventListener("change", e => { UI.assignee = e.target.value; render(); });
$("#fClientOwner").addEventListener("change", e => { UI.clientOwner = e.target.value; render(); });
$("#fType").addEventListener("change", e => { UI.type = e.target.value; render(); });
$("#fEscalation").addEventListener("change", e => { UI.escalation = e.target.value; render(); });
$("#fMeeting").addEventListener("change", e => { UI.meeting = e.target.value; render(); });
$("#fHideClosed").addEventListener("click", e => {
  UI.hideClosed = !UI.hideClosed;
  e.target.classList.toggle("on", UI.hideClosed);
  localStorage.setItem("sfmcHideClosed", UI.hideClosed ? "1" : "0");
  render();
});

if (UI.hideClosed) $("#fHideClosed").classList.add("on");
if (location.pathname.replace(/\/$/, "") === "/proposals") UI.view = "proposals";
document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.view === UI.view));
reload()
  .then(loadProposals)
  .then(render)
  .catch(e => toast("Could not load data: " + e.message, true));

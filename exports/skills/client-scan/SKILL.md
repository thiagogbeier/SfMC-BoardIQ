# client-scan

**Description (for `m_create_skill`):**

> Scan a client's email and Teams and propose board items for review. Use when the
> user says "scan [client]", "scan new clients", "first pass for [client]", "check
> email for [client] board", or wants board proposals for any client. Same logic as
> the scheduled Board Proposals automation, runnable on demand.

---

## Instructions

Scan one or more clients and post board proposals for review. Never create, update
or delete board items — the human approves each proposal on the Proposals page.

API  = http://127.0.0.1:8791/api
BASE = `<YOUR-BOARD-FOLDER>`

### 1. Work out the target

- If the user named a client, match it against `name` and `searchTerms` in GET {API}/store.
- "new" / "never scanned" → every scanEnabled client with no `lastScan`.
- "queued" → every client with `scanRequested: true`.
- "all" → every scanEnabled, non-archived client.
- No target given → do the queued ones, then the never-scanned ones. Say what you picked.

If the API is not responding, start it: `python server.py --port 8791 --no-browser`
from BASE as a detached background process, wait 3s, retry.

### 2. Pick a mode per client

**FIRST PASS** — no items, no `lastScan`, or every item has `source: "ado"` (its mail
has never been read).

- Look back 90 days.
- Build the board from nothing: standing cadences and recurring meetings; open and
  recently closed cases with case numbers; escalations and DCRs with IDs and status;
  active projects, migrations and workstreams; commitments made to the client; risks
  and blockers; contract or renewal milestones. Include closed items worth keeping as
  a record, in their closed state.
- 8–15 proposals is healthy for an active client. Zero is correct for a dormant one —
  say so rather than inventing work.

**INCREMENTAL** — established board with a `lastScan`.

- Only material newer than `lastScan`. Focus on what changed: new work, state changes,
  slipped meetings, new cases, closures.

### 3. Scan

Search email and Teams using EVERY comma-separated value in that client's `searchTerms`.
Organisations appear under multiple legal names and aliases — a company often files
support cases under an operating-company name that differs from its display name.
Searching the display name alone silently misses work.

Use `workiq_search_emails`, `workiq_get_email`, `workiq_search_chats`,
`workiq_list_chat_messages`. Read actual bodies — never propose from a subject line.

Ignore OOF replies, meeting accept/decline notices, newsletters, expired-recording notices.

### 4. Build proposals

- `add` — new work not on the board
- `update` — existing item whose facts changed (set `targetItemId`)
- `replace` — existing item now wrong or duplicated (set `targetItemId`)

Never propose an `add` matching an existing item — use `update`/`replace` or nothing.

Tag each `evidenced` (quote the message in the description) or `inferred` (your
judgement). Never disguise inference as evidence. Use `note` for contradictions,
ambiguous dates, or why you inferred it.

Populate: type (User Story/Task/Bug/Risk/Meeting/Milestone), state, priority 1-4,
assignedTo, clientOwner, tags, description, acceptance, dueDate, cssCase +
cssCaseNumber, dcr + dcrId + dcrStatus, escalatedTo + escalationStatus, meetingStatus
(N/A|Scheduling|Scheduled|TBR).

A genuine exposure is a Risk, not a Task. A slipped meeting is TBR.

### 5. Post

POST {API}/proposals once:

```json
{"runId":"<yyyy-MM-dd-HHmm>","date":"<yyyy-MM-dd>","proposals":[
  {"clientId":"contoso-financial","kind":"add","evidence":"evidenced",
   "source":"email 2026-09-03 Lena Vasquez","note":"optional","item":{}},
  {"clientId":"contoso-financial","kind":"update","evidence":"evidenced",
   "source":"...","targetItemId":"...","targetTitle":"...","patch":{}}
]}
```

### 6. Clear the flags

For each client actually scanned, PUT {API}/clients/{id} with `lastScan` = now (ISO)
and `scanRequested` = false — including clients where you found nothing, so they don't
get re-swept.

### 7. Report in chat

Per-client counts, which were FIRST PASS, the most time-sensitive item, how many are
`inferred`, any client lead worth setting, and the link:
http://127.0.0.1:8791/proposals

NEVER call POST/PUT/DELETE on {API}/items.

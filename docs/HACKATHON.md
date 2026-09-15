# Hackathon guide — building on SfMC:BoardIQ

Four prompts you can run live, in order, each producing something visible on screen
within a few minutes. They're written to be **repeatable**: every one can be reset in
a single command, so you can rehearse, demo, break it, and run it again.

---

## Before you start

```powershell
cd "path\to\SfMC-BoardIQ"
.\Start.cmd                 # or: python server.py --port 8791 --no-browser
```

Open <http://127.0.0.1:8791>. You should see **6 clients · 29 open items**.

**Reset between runs** — this is the whole safety net:

```powershell
python seed_demo.py         # rebuilds the 6 fictitious clients / 37 items
.\Watchdog.ps1 -Restart
```

Deterministic, and dates are always relative to today, so the board never looks stale.
Nothing you do in these prompts can be lost.

### What the thing actually is, in one paragraph

Give this to your agent as context and the prompts below will land far better:

> SfMC:BoardIQ is a local-first delivery board. A Python stdlib HTTP server on
> `127.0.0.1:8791` serves a plain-JS UI and a small JSON API, with all state in one
> file, `data/store.json`. Clients have boards; boards have items with a rich field set
> (state, priority, owners on both sides, escalation targets, support case, DCR, meeting
> status). The distinguishing idea is the **proposals queue**: an agent reads mail and
> Teams and POSTs *proposed* changes to `/api/proposals`, where a human accepts, skips,
> archives or deletes each one. Nothing reaches a board without a person approving it.

---

## The API you'll be prompting against

Everything below is verified working. Base: `http://127.0.0.1:8791/api`

| Method | Path | Does |
|---|---|---|
| GET | `/store` | Whole dataset: `instance`, `settings`, `clients`, `items` |
| GET | `/proposals?status=pending\|all` | The review queue |
| POST | `/proposals` | Ingest a batch of proposals |
| POST | `/proposals/{id}/decide` | `{"action":"accept\|skip\|archive\|delete"}` |
| POST | `/proposals/decide` | Same, bulk: `{"ids":[…],"action":"…"}` |
| POST | `/proposals/purge` | `{"keep":"pending"}` or `{"keep":"none"}` |
| POST | `/items` | Create an item |
| PUT | `/items/{id}` | Update fields |
| DELETE | `/items/{id}` | Delete |
| POST | `/items/bulk` | `{"ids":[…],"action":"archive\|delete"}` |
| POST | `/items/reorder` | Drag-and-drop persistence |
| POST | `/clients` | Create a client (auto-derives `searchTerms`, queues a scan) |
| PUT | `/clients/{id}` | Update |
| POST | `/scan-queue` | `{"ids":[…]}` or `{"scope":"new"\|"all"}` |
| PUT | `/settings` | Dropdown vocabularies |

Dropdown values live in `settings` — types, states, priorities, escalation targets,
meeting statuses. They are **data, not code**, so an agent can extend the vocabulary
without touching the app.

---

## Prompt 1 — Turn a meeting into proposals

*Warm-up. Shows the core loop end to end in about two minutes.*

> You have a local delivery board running at `http://127.0.0.1:8791`. Its API is
> documented at `/readme`.
>
> Here are my notes from a customer call with **Contoso Financial Group**:
>
> *"Marcus walked us through the Q4 audit. Their regulator wants evidence of least
> privilege by end of October — that's now a hard date, not a nice-to-have. Lena
> flagged that the DLP false-positive rate is still around 18% and her team is losing
> confidence in it; she wants a tuning session booked before month end. We also agreed
> the tenant-to-tenant migration discussion slips to Q1 because the acquisition hasn't
> closed. Marcus asked whether Microsoft can put someone senior on the transport-rule
> issue — it's been open three weeks and settlement confirmations are still delayed."*
>
> Read the current Contoso board via `GET /api/store`. Then POST a batch to
> `/api/proposals` with one proposal per distinct thing above. Use `kind: "add"` for
> genuinely new work and `kind: "update"` with `targetItemId` for anything the board
> already covers — do **not** create a near-duplicate of an existing item. Tag each
> proposal `evidenced` if it's traceable to a sentence in my notes, or `inferred` if
> it's your own judgement, and say which in the description.
>
> Then show me a table of what you queued and stop. Do not write to `/api/items`.

**What to watch for.** A good agent notices that the transport-rule issue, the DLP
tuning and the tenant-to-tenant migration are all *already on the board* and proposes
updates rather than duplicates. A lazy one adds four new cards and the Proposals page
flags them as possible duplicates with a match percentage — which is itself a good
thing to show the room.

Open the **Proposals** tab and walk the reviewer through Add / Skip / Archive / Delete.

**Reset:**
```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8791/api/proposals/purge `
  -ContentType 'application/json' -Body '{"keep":"none"}'
```

---

## Prompt 2 — Find what the board is hiding

*This is the one that tends to get a reaction. It's analysis, not data entry.*

> Fetch `GET http://127.0.0.1:8791/api/store` and audit the portfolio like a delivery
> manager preparing for a review. Do not change anything.
>
> Report:
> 1. Every item that is **stalled** — open, not Closed, and unchanged for more than 30
>    days. Include the client, the age in days, and who owns it.
> 2. Every **escalation** (`escalatedTo` non-empty, or `dcr` true) and whether it has a
>    support case number attached. Flag any escalation with no case as a governance gap.
> 3. Every item where `meetingStatus` is `Scheduling` or `TBR` — these are sessions
>    that were agreed and never actually booked.
> 4. Any client whose `contractEnd` is inside 120 days, with a count of their open items.
> 5. Any item with **no `clientOwner`** — work nobody on the customer side owns.
>
> Finish with the **three things you would escalate on Monday morning**, in priority
> order, each with one sentence of justification grounded in the data. Show your
> per-item working in a table, not just the conclusions.

**What to watch for.** The demo data is seeded so this produces real findings —
**three genuinely stalled items** (an on-hold CSAM escalation untouched for 47 days, a
cadence "chased three times" sitting at 33 days, and a Copilot readiness task still
marked *Scheduling* a month after it was raised), Fabrikam's contract ending inside 90
days, a resourcing escalation with **no support case attached**, two `TBR` meetings that
were agreed and quietly dropped, and ten open items with **no owner on the customer
side**. If an agent returns "everything looks healthy", it hasn't actually read the data.

**Extension for stronger teams:** have it POST the findings back as proposals — a `Risk`
item per governance gap, with `escalatedTo` and `escalationStatus` set.

**Reset:** none needed, this is read-only.

---

## Prompt 3 — Onboard a client from scratch

*Demonstrates the schema, the derive-then-review pattern, and bulk writes.*

> Create a new client on the board at `http://127.0.0.1:8791` called
> **Tailspin Insurance Group** — `POST /api/clients` with a sensible `packageName`,
> `status`, and a `contractEnd` about 14 months out.
>
> Note what the server auto-derives for `searchTerms` and tell me whether you'd trust
> it. Insurers commonly file support cases under an operating-company name that differs
> from the brand — improve the terms and `PUT` them back.
>
> Then build the client's opening board. Create 8–12 items via `POST /api/items` that
> represent a realistic first 90 days of a Microsoft delivery engagement: a couple of
> standing cadences, an active migration, at least one genuine Risk, one item with a
> support case, one with a DCR, one Milestone with a `dueDate`, and a mix of states
> across New / Active / In Progress. Populate `clientOwner` with plausible names and use
> the vocabularies in `settings` — don't invent new states or types.
>
> Then show me the board summary and explain which single item you'd bring to the first
> governance call.

**What to watch for.** The auto-derived terms for "Tailspin Insurance Group" will be
something like `Tailspin Insurance Group, Tailspin Insurance, tailspin.com` — plausible,
and exactly the kind of guess that silently misses half a client's real traffic. An agent
that just accepts it has missed the point of the field; the interesting answer explains
*why* a human has to review it.

**Reset:**
```powershell
python seed_demo.py
.\Watchdog.ps1 -Restart
```

---

## Prompt 4 — Extend the system itself

*Open-ended. This is where teams differentiate.*

> The board at `http://127.0.0.1:8791` stores everything in `data/store.json` and serves
> a plain-JS UI from `app/`. There is no framework and no build step. `server.py` is
> Python standard library only.
>
> Add a capability that doesn't exist yet. Pick one:
>
> - **A weekly digest.** A script that reads the store and produces a standalone HTML
>   summary — what moved, what stalled, what's escalated, what's due — styled to match
>   the existing theme variables in `app/styles.css` so it looks native.
> - **A new field, end to end.** Something the model genuinely lacks: a confidence
>   rating on proposals, a blocked-by relationship between items, effort tracking. Add
>   it to `ITEM_FIELDS` in `server.py`, surface it in the item drawer and as a card chip
>   in `app/app.js`, add a filter, and make it visible on the dashboard.
> - **A second data source.** The proposals API accepts a batch from anywhere. Feed it
>   from something other than mail — a ticketing export, a CSV, a webhook, a calendar.
>   The board shouldn't care where a proposal came from.
> - **A quality gate.** Something that inspects proposals before a human sees them and
>   flags weak ones: no evidence quoted, a due date in the past, an escalation with no
>   owner, a description that just restates the title.
>
> Constraints that matter: **Python standard library only**, no build step, and nothing
> may write to `/api/items` without a human approving it. Keep the local-first,
> human-in-the-loop character intact.
>
> Before you write code, read `README.md` and `server.py`, then tell me your plan and
> what you'll change. Wait for my go-ahead.

**What to watch for.** The "wait for my go-ahead" is deliberate — it separates teams who
understand the codebase from teams who pattern-match and start editing. The strongest
answers respect the two architectural rules (`coerce_lists` for list-valued fields;
instance-specific values belong in `instance.json`, never hardcoded).

**Reset:**
```powershell
git checkout -- .          # if working in a clone
python seed_demo.py
.\Watchdog.ps1 -Restart
```

---

## Running these live

**Order matters.** 1 → 2 → 3 → 4 builds from "watch it work" to "extend it". If you only
have ten minutes, run **1 and 2** — together they show the full proposal loop and prove
the agent is reasoning about real data rather than generating plausible text.

**Have the Proposals tab open on a second screen.** Prompt 1 is dramatically more
convincing when the room watches rows appear in the review queue while the agent talks.

**Reset between teams.** `python seed_demo.py` then `.\Watchdog.ps1 -Restart`. Ten
seconds, and every team starts from an identical board.

### Things that will trip people up

| Symptom | Cause |
|---|---|
| "Running scripts is disabled" | Mark of the Web. Use `Start.cmd`, or `Get-ChildItem -Recurse -File \| Unblock-File` |
| "Port 8791 already in use" | It's already running — just browse to it. One copy per port, by design |
| Proposals POST returns `duplicates > 0` | Working as intended — it rejected something ≥85% similar to a pending proposal |
| Agent says it "added items to the board" | It called `/api/items` directly. That's the one rule: propose, don't write |
| Page blank after an edit | `data/backups/` has a snapshot from before every write |

### Judging suggestions

- **Did it read before it wrote?** `GET /api/store` before proposing is the difference
  between a duplicate and an update.
- **Evidenced vs inferred.** Does the agent distinguish what it was told from what it
  concluded — or blur the two?
- **Did it respect the human gate?** Anything that writes straight to `/api/items` has
  missed the entire point.
- **Is the reasoning grounded?** Prompt 2 can be answered with generic delivery-manager
  platitudes. The good answers cite item titles, ages and owners.

---

All demo data is fictitious. Contoso, Northwind, Fabrikam and Tailspin are Microsoft's
standard fictitious brands; every person, case number and date in the dataset is invented.
Nothing here relates to a real customer, so it's safe to project, record or share.

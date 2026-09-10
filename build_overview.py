"""Build docs/SfMC-BoardIQ-overview.html - a self-contained demo deck.

Reads its styling and navigation from docs/deck/ so this project folder is a
standalone repository with no dependency on the production board. Those two
assets originated from the production overview deck, so both presentations
look and behave identically.

Images are embedded as base64 so the file works from OneDrive/SharePoint
preview, email, or a USB stick with no external assets.

Run:  python build_overview.py
"""
import base64
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(ROOT, "docs")
SHOTS = os.path.join(DOCS, "screenshots")
DECK = os.path.join(DOCS, "deck")
OUT = os.path.join(DOCS, "SfMC-BoardIQ-overview.html")


def asset(name):
    path = os.path.join(DECK, name)
    if not os.path.exists(path):
        raise SystemExit(f"missing deck asset: {path}")
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def img(name):
    with open(os.path.join(SHOTS, name), "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


CSS = asset("theme.css")
NAV = asset("nav.js")

SHOT = {n: img(n) for n in sorted(os.listdir(SHOTS)) if n.endswith(".jpg")}


def media(title, sub, shot, note=""):
    note_html = f'<p class="note">{note}</p>' if note else ""
    return f"""
<section class="slide media">
  <h2>{title}</h2>
  <p class="sub">{sub}</p>
  <div class="shot-wrap"><img class="shot" src="{SHOT[shot]}" alt="{title}"></div>
  {note_html}
</section>"""


SLIDES = []

# ---------------------------------------------------------------- 1. title
SLIDES.append("""
<section class="slide title-slide on">
  <div class="eyebrow">Solution overview</div>
  <h1>SfMC:BoardIQ</h1>
  <p class="kicker">
    A delivery board for every engagement you own — customer or internal — built
    from the work that is already happening in your mailbox and your chats.
    Runs entirely on your own machine.
  </p>
  <div class="meta">
    <span class="pill accent">Local-first</span>
    <span class="pill">No database</span>
    <span class="pill">No cloud service</span>
    <span class="pill">Python standard library only</span>
    <span class="pill ok">Nothing changes without your approval</span>
  </div>
  <p class="hint">← → or space to move · F for full screen · T to switch theme</p>
</section>""")

# ---------------------------------------------------------------- 2. problem
SLIDES.append("""
<section class="slide">
  <div class="eyebrow">The problem</div>
  <h2>Delivery context lives in inboxes</h2>
  <p class="sub">
    The commitments that actually define an engagement are scattered across mail
    threads, chats and meeting invites. Only some engagements have a project
    tracker — and the ones that do not are exactly the ones that go quiet.
  </p>
  <div class="grid g3" style="margin-top:8px">
    <div class="card bad">
      <h3>Not every engagement has a board</h3>
      <p>Tooling tends to exist where a project was formally stood up. The rest are tracked in someone's head.</p>
    </div>
    <div class="card warn">
      <h3>Status is reconstructed, not recorded</h3>
      <p>Preparing for a review means re-reading weeks of mail to remember what was promised and to whom.</p>
    </div>
    <div class="card">
      <h3>Silence looks like health</h3>
      <p>An engagement with no recent activity is indistinguishable from one that is going well.</p>
    </div>
  </div>
  <p class="note">This deck uses fictitious companies and invented data throughout.</p>
</section>""")

# ---------------------------------------------------------------- 3. answer
SLIDES.append(media(
    "A board per engagement, in one place",
    "Customer engagements and internal workstreams sit side by side. Open counts, "
    "package details and contract countdowns are visible without opening anything.",
    "01-portfolio.jpg",
    "Fictitious data. Contract countdown turns amber inside 90 days."))

# ---------------------------------------------------------------- 4. board
SLIDES.append(media(
    "Drag to move. Chips carry the detail.",
    "A familiar five-column flow. Every badge on a card answers a question you would "
    "otherwise have to open the item to ask — who owns it on the customer side, is it "
    "escalated, is there a support case, is a meeting booked.",
    "02-client-board.jpg"))

# ---------------------------------------------------------------- 5. fields
SLIDES.append(media(
    "Every field the engagement actually needs",
    "Beyond the usual title and state: a named owner on the customer side, escalation "
    "targets and status, support case number, design change request and its status, "
    "and whether the meeting is booked, being scheduled, or needs rescheduling.",
    "03-item-detail.jpg"))

# ---------------------------------------------------------------- 6. why fields
SLIDES.append("""
<section class="slide">
  <div class="eyebrow">Why these fields</div>
  <h2>Each one answers a question someone asks you</h2>
  <div class="grid g2" style="margin-top:8px">
    <div class="card accent">
      <h3>Client owner</h3>
      <p>"Who owns this on their side?" Without it, every follow-up starts by finding a name.</p>
    </div>
    <div class="card accent">
      <h3>Escalated to · status</h3>
      <p>PM, PG, CSAM, Resourcing, Manager. Shows what has been raised, to whom, and whether it moved.</p>
    </div>
    <div class="card accent">
      <h3>Support case · DCR</h3>
      <p>Ties delivery work to the formal support and product-change record, so a review can be evidenced.</p>
    </div>
    <div class="card accent">
      <h3>Meeting status</h3>
      <p>N/A · Scheduling · Scheduled · To be rescheduled. Surfaces the sessions that quietly never got booked.</p>
    </div>
  </div>
  <p class="note">
    The dropdown values are data, not code — new options can be added without touching the application.
  </p>
</section>""")

# ---------------------------------------------------------------- 7. dashboard
SLIDES.append(media(
    "Is the workload moving?",
    "New versus closed over a window you choose, plus ageing, escalation load, overdue "
    "items and meetings still to be booked. Filter to one engagement or view the whole portfolio.",
    "04-dashboard.jpg",
    "Charts are hand-drawn SVG — no charting library, no external requests."))

# ---------------------------------------------------------------- 8. items
SLIDES.append(media(
    "Every item, one sortable list",
    "When the board view is the wrong shape — preparing a review, auditing owners, "
    "or clearing a backlog — the same data appears as a flat, sortable, bulk-editable list.",
    "05-items.jpg"))

# ---------------------------------------------------------------- 9. automation
SLIDES.append("""
<section class="slide">
  <div class="eyebrow">The part that saves the time</div>
  <h2>It reads the traffic and proposes the work</h2>
  <p class="sub">
    A scheduled run each morning reads mail and chat for each engagement and drafts
    board changes. It never writes to a board on its own.
  </p>
  <div class="flow" style="margin-top:10px">
    <div class="step"><div class="k">01</div><h4>Pick the engagements</h4>
      <p>Never-scanned first, then whichever was scanned longest ago.</p></div>
    <div class="arrow">→</div>
    <div class="step"><div class="k">02</div><h4>Read the traffic</h4>
      <p>Mail and chat, matched on every known alias for that organisation.</p></div>
    <div class="arrow">→</div>
    <div class="step"><div class="k">03</div><h4>Draft changes</h4>
      <p>Add, update or replace — each labelled as evidenced or inferred.</p></div>
    <div class="arrow">→</div>
    <div class="step"><div class="k">04</div><h4>Wait</h4>
      <p>Proposals queue for review. Nothing reaches a board unapproved.</p></div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card ok"><h3>Evidenced vs inferred</h3>
      <p>Every proposal says whether it quotes a real message or is the model's own judgement. The two are never blurred.</p></div>
    <div class="card ok"><h3>Duplicate-aware</h3>
      <p>Proposals are matched against existing items by title similarity and flagged before they can be added twice.</p></div>
    <div class="card ok"><h3>Decisions stick</h3>
      <p>Something you skip is remembered and never proposed again.</p></div>
  </div>
</section>""")

# ---------------------------------------------------------------- 10. proposals
SLIDES.append(media(
    "Current item, proposed item, your call",
    "Each proposal is shown against whatever it would change, field by field, with "
    "differences highlighted. Four choices: add or apply, skip, archive the existing "
    "item, or delete it.",
    "07-proposals.jpg",
    "Top: a new item, with no current counterpart. Below: an update matched to an "
    "existing item, with only the changed fields highlighted."))

# ---------------------------------------------------------------- 11. coverage
SLIDES.append(media(
    "No engagement can go quiet unnoticed",
    "Each one carries its own aliases, a scan toggle and the timestamp of its last "
    "read. Anything never scanned is called out, and a new engagement is queued for "
    "a first pass the moment it is created.",
    "06-clients.jpg",
    "Aliases matter: organisations file cases under names that differ from their display name."))

# ---------------------------------------------------------------- 12. theme
SLIDES.append(media(
    "Light and dark, no configuration",
    "The interface follows the system theme and can be toggled at any time — useful "
    "when the board is on screen in a room you do not control.",
    "08-dark.jpg"))

# ---------------------------------------------------------------- 13. architecture
SLIDES.append("""
<section class="slide">
  <div class="eyebrow">How it runs</div>
  <h2>Deliberately small</h2>
  <div class="grid g4" style="margin-top:6px">
    <div class="card stat"><div class="n">1</div><div class="l">Python file</div>
      <div class="s">standard library only — no packages to install</div></div>
    <div class="card stat"><div class="n">0</div><div class="l">Dependencies</div>
      <div class="s">no framework, no build step, no database</div></div>
    <div class="card stat"><div class="n">1</div><div class="l">JSON file</div>
      <div class="s">the whole dataset — readable and diffable</div></div>
    <div class="card stat"><div class="n">127.0.0.1</div><div class="l">Bound locally</div>
      <div class="s">not reachable from the network</div></div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>Durable by design</h3>
      <p>Every write re-reads from disk, snapshots the previous state, writes to a temporary file and swaps it in atomically.</p></div>
    <div class="card"><h3>Stays up on its own</h3>
      <p>A scheduled task starts it at logon and checks every five minutes, restarting it if it stopped. No app needs to be open.</p></div>
    <div class="card"><h3>Portable</h3>
      <p>Copy the folder, change one settings file, and you have a second independent instance on its own port.</p></div>
  </div>
</section>""")

# ---------------------------------------------------------------- 14. two instances
SLIDES.append("""
<section class="slide">
  <div class="eyebrow">One codebase, many boards</div>
  <h2>The demo you are looking at is a second instance</h2>
  <p class="sub">
    This deck was captured from a separate deployment running alongside the real one,
    on its own port, with its own data. Both run byte-identical code.
  </p>
  <table class="t" style="margin-top:10px">
    <tr><th>What differs</th><th>How</th></tr>
    <tr><td>Name, logo, header</td><td class="mono">instance.json</td></tr>
    <tr><td>Port</td><td class="mono">instance.json</td></tr>
    <tr><td>Which boards pin to the bottom</td><td class="mono">instance.json</td></tr>
    <tr><td>Whether tracker sync is offered</td><td class="mono">instance.json</td></tr>
    <tr><td>The data itself</td><td class="mono">data\\store.json</td></tr>
  </table>
  <div class="grid g2" style="margin-top:16px">
    <div class="card ok"><h3>Features flow one way</h3>
      <p>An update script copies code from the live board into the demo, backs up what it replaces, and restarts it. Data and settings are never touched.</p></div>
    <div class="card"><h3>Safe to demonstrate</h3>
      <p>The demo holds only invented data, so it can be shown to anyone without a privacy review.</p></div>
  </div>
</section>""")

# ---------------------------------------------------------------- 15. close
SLIDES.append("""
<section class="slide">
  <div class="eyebrow">What changes</div>
  <h2>From reconstructing status to reading it</h2>
  <div class="grid g2" style="margin-top:8px">
    <div class="card bad"><h3>Before</h3>
      <p>Status rebuilt from memory and mail archaeology before every review. Engagements without a tracker rely on whoever remembers them. Commitments made in a meeting survive only in the transcript.</p></div>
    <div class="card ok"><h3>After</h3>
      <p>Every engagement has a board. The morning run proposes what changed and waits. Escalations, cases and unbooked meetings are visible across the portfolio in one view.</p></div>
  </div>
  <div class="grid g3" style="margin-top:18px">
    <div class="card accent"><h3>Human in the loop</h3><p>The system proposes. A person decides. That boundary is not configurable.</p></div>
    <div class="card accent"><h3>Evidence, not vibes</h3><p>Proposals cite the message they came from, or admit that they are an inference.</p></div>
    <div class="card accent"><h3>Yours to keep</h3><p>One folder, one JSON file. No service to depend on, nothing to migrate off.</p></div>
  </div>
  <p class="note">All companies, people, cases and dates shown in this deck are fictitious.</p>
</section>""")

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SfMC:BoardIQ — Solution Overview</title>
<script>
  (() => {{
    const param = new URLSearchParams(window.location.search).get("scoutTheme");
    const theme =
      param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  }})();
</script>
<style>{CSS}</style>
</head>
<body>
<div class="progress" id="progress"></div>
<div class="deck">
{''.join(SLIDES)}
</div>

<div class="bar">
  <span class="logo">SfMC</span>
  <span class="title">SfMC:BoardIQ — Solution Overview</span>
  <span class="spacer"></span>
  <div class="dots" id="dots"></div>
  <button class="btn" id="prev">←</button>
  <span class="counter" id="counter"></span>
  <button class="btn" id="next">→</button>
  <button class="btn" id="theme" title="Toggle theme">◐</button>
  <button class="btn" id="full" title="Full screen">⛶</button>
</div>

<script>
{NAV}
</script>
</body>
</html>
"""

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(HTML)

print(f"wrote {OUT}")
print(f"slides: {len(SLIDES)}")
print(f"images: {len(SHOT)}")
print(f"size  : {os.path.getsize(OUT) / 1024:.0f} KB")

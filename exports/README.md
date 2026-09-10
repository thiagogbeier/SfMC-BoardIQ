# exports — Scout automation & skill

Everything Microsoft Scout needs to keep the boards current. These two files are
what turn a static board into a self-updating one.

| File | What it is |
|---|---|
| `automations\board-proposals.json` | Scheduled automation — reads mail and Teams every weekday and queues proposed board changes |
| `skills\client-scan\SKILL.md` | The same logic as a **slash command**, `/client-scan`, for running on demand |

Both **propose only**. Neither can create, update or delete a board item — that
boundary is stated in the prompt and enforced by the closing line
`NEVER call POST/PUT/DELETE on {API}/items`. Every change is reviewed by a human
on the Proposals page.

---

## Before you import

Both files contain the placeholder `<YOUR-BOARD-FOLDER>`. Replace it with the
absolute path to the folder holding `server.py`, for example:

```
C:\GitHub\SfMC-BoardIQ
```

Check the port too. Both files assume **8791** (the value in `instance.json`). If
you changed it, change it here as well — the automation calls
`http://127.0.0.1:8791/api`.

---

## Importing

Scout has no file-based import, so the fastest path is to ask it directly. Start a
new Scout session **in this repo folder** and paste:

```
Read exports\automations\board-proposals.json and create that automation with
m_create_automation, using the name, description, model, schedule, triggerType,
teamsNotify and prompt exactly as written. Replace <YOUR-BOARD-FOLDER> with the
absolute path of this repo folder. Leave it disabled.

Then read exports\skills\client-scan\SKILL.md and create a skill named
"client-scan" with m_create_skill, using the description under
"Description (for m_create_skill)" and everything under "## Instructions" as the
instructions. Replace <YOUR-BOARD-FOLDER> the same way.

Confirm both were created and show me the automation id.
```

### Or by hand

**Automation** — `m_create_automation` with:

| Field | Value |
|---|---|
| `name` | `SfMC-BoardIQ Board Proposals` |
| `description` | from the JSON |
| `model` | `claude-opus-5` |
| `schedule` | `every weekday at 7:15am` |
| `triggerType` | `schedule` |
| `teamsNotify` | `auto` |
| `enabled` | `false` — see below |
| `prompt` | the `prompt` string, with `<YOUR-BOARD-FOLDER>` replaced |

**Skill** — `m_create_skill` with name `client-scan`, the description from the top
of `SKILL.md`, and the body of `## Instructions` as the instructions.

---

## Why it ships disabled

`"enabled": false` is deliberate. Turn it on only once you have confirmed:

1. The board answers — <http://127.0.0.1:8791/api/store> returns JSON.
2. The BASE path in the prompt is right for **this** machine.
3. You are happy for it to read your mail and Teams every weekday morning.

Enable it when ready:

```
Enable the SfMC-BoardIQ Board Proposals automation.
```

Or run it once without waiting for the schedule:

```
Run the SfMC-BoardIQ Board Proposals automation now.
```

---

## Trying it against demo data

The demo clients are fictitious, so a real mail scan will find **nothing** for
Contoso, Northwind or Fabrikam — and reporting zero is the correct behaviour, not
a failure.

To see the full proposal loop end to end without touching a real mailbox, seed the
queue by hand:

```powershell
$body = @{
  runId = (Get-Date -Format 'yyyy-MM-dd-HHmm')
  date  = (Get-Date -Format 'yyyy-MM-dd')
  proposals = @(
    @{ clientId='contoso-financial'; kind='add'; evidence='evidenced'
       source='email 2026-09-03 Lena Vasquez'
       item=@{ title='Quarterly access review evidence pack'; type='Task'
               state='New'; priority=2; assignedTo='Sam Okafor'
               clientOwner='Lena Vasquez'; tags=@('audit','compliance')
               description='Demo proposal - shows the add path on the review page.' } },
    @{ clientId='northwind'; kind='update'; evidence='inferred'
       source='chat 2026-09-05 delivery channel'
       targetTitle='Wave 4 scoping workshop'
       note='Demo proposal - shows a field-level diff against a real item.'
       patch=@{ meetingStatus='Scheduled'; priority='2' } }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post 'http://127.0.0.1:8791/api/proposals' `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Then open <http://127.0.0.1:8791/proposals>. You will see:

- the **add** flagged as a possible duplicate if anything similar already exists;
- the **update** shown side by side against *Wave 4 scoping workshop*, with the two
  changed fields highlighted;
- four actions per row — **Add/Apply**, **Skip**, **Archive current**, **Delete current**.

Clear the queue afterwards by skipping both rows, or reset everything with
`python seed_demo.py` from the repo root.

> The `update` above deliberately omits `targetItemId` and relies on `targetTitle`
> matching. That is the fuzzy-match path — useful to demonstrate, but in real runs
> the automation is told to send an explicit `targetItemId` whenever it has one.

---

## Using this for real work

If you point the automation at a board with real clients:

1. Set each client's **`searchTerms`** on the Clients tab. This is the single most
   important field — organisations file cases under names that differ from their
   display name, and searching the display name alone silently misses work. The
   auto-derived value is a starting guess; it needs a human eye.
2. Leave **`scanEnabled`** off for internal boards (a "My Team" board has no mail to
   read).
3. Use **`scanRequested`** — the *Scan now* button on the Clients tab — to jump a
   client to the front of tomorrow's queue.

The run is time-boxed to about five clients. Anything it does not reach stays
untouched and is first in line next time.

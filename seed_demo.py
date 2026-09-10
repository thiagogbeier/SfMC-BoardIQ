"""Seed the SfMC:BoardIQ demo store with fictitious data.

Everything here is invented. Company names are Microsoft's standard
fictitious brands (Northwind, Contoso, Fabrikam) so nothing can be
mistaken for a real customer.

Run:  python seed_demo.py
"""
import hashlib
import json, os, random
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
STORE = os.path.join(DATA, "store.json")

random.seed(20260908)  # stable output between runs
NOW = datetime.now(timezone.utc).astimezone()


def stable_id(*parts, length=12):
    """Deterministic id derived from the item's own identity.

    uuid4() ignores random.seed(), so using it here regenerated every id on
    every run - a ~96-line git diff on data/store.json each export, with no
    real change in it. Hashing the content instead makes reseeding idempotent,
    so a diff only ever shows something that actually changed.
    """
    key = "\u0000".join(str(p) for p in parts)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:length]


def iso(days_ago, hour=10):
    d = NOW - timedelta(days=days_ago)
    return d.replace(hour=hour % 24, minute=(days_ago * 7) % 60, second=0,
                     microsecond=0).isoformat(timespec="seconds")


SETTINGS = {
    "columns": ["New", "Active", "In Progress", "Resolved", "Closed"],
    "types": ["User Story", "Task", "Bug", "Risk", "Meeting", "Milestone"],
    "priorities": [1, 2, 3, 4],
    "valueAreas": ["Business", "Architectural"],
    "riskLevels": ["1 - High", "2 - Medium", "3 - Low"],
    "escalationTargets": ["PM", "PG", "CSAM", "Resourcing", "Manager"],
    "escalationStatuses": ["submitted", "on-hold", "rejected"],
    "dcrStatuses": ["submitted", "in progress", "escalated", "reject"],
    "meetingStatuses": ["N/A", "Scheduling", "Scheduled", "TBR"],
}

CLIENTS = [
    dict(id="northwind", name="NORTHWIND TRADERS",
         packageName="Mission Critical Office 365 Transition", packageId="100200301",
         status="completed", contractEnd="2027-06-30",
         clientLead="Dana Whitfield", clientLeadRole="Director, Digital Workplace",
         clientLeadEmail="dana.whitfield@northwindtraders.example",
         searchTerms="Northwind Traders, Northwind, NWT, northwindtraders.example",
         notes="Retail / logistics. Largest Teams estate in the demo set. Mid-transition to Intune.",
         scanEnabled=True, lastScan=iso(2)),
    dict(id="contoso-financial", name="CONTOSO FINANCIAL GROUP",
         packageName="Mission Critical Intelligent Cloud", packageId="100200302",
         status="completed", contractEnd="2027-02-28",
         clientLead="Marcus Bell", clientLeadRole="VP, Infrastructure & Security",
         clientLeadEmail="marcus.bell@contosofinancial.example",
         searchTerms="Contoso Financial Group, Contoso Financial, CFG, contosofinancial.example",
         notes="Regulated financial services. Heavy change control, two live escalations.",
         scanEnabled=True, lastScan=iso(1)),
    dict(id="fabrikam-health", name="FABRIKAM HEALTH SYSTEMS",
         packageName="Mission Critical Office 365 Transition", packageId="100200303",
         status="pending", contractEnd="2026-11-30",
         clientLead="Priya Raman", clientLeadRole="Manager, End User Experience",
         clientLeadEmail="priya.raman@fabrikamhealth.example",
         searchTerms="Fabrikam Health Systems, Fabrikam Health, FHS, fabrikamhealth.example",
         notes="Healthcare. Contract renewal inside 90 days - watch the countdown chip.",
         scanEnabled=True, lastScan=iso(6)),
    dict(id="my-team", name="My Team",
         packageName="Internal", packageId="", status="completed", contractEnd="",
         clientLead="", clientLeadRole="", clientLeadEmail="",
         searchTerms="", notes="Team rhythm of business, internal deliverables.",
         scanEnabled=False, lastScan=""),
    dict(id="manager-1-1", name="Manager 1:1",
         packageName="Internal", packageId="", status="completed", contractEnd="",
         clientLead="", clientLeadRole="", clientLeadEmail="",
         searchTerms="", notes="Running agenda for 1:1s - carried between sessions.",
         scanEnabled=False, lastScan=""),
    dict(id="mylearning", name="MyLearning",
         packageName="Internal", packageId="", status="completed", contractEnd="",
         clientLead="", clientLeadRole="", clientLeadEmail="",
         searchTerms="", notes="Certifications, labs and skilling goals.",
         scanEnabled=False, lastScan=""),
]

MS = ["Alex Moreau", "Sam Okafor", "Jordan Reyes", "Riley Chen", "Taylor Nkemdirim"]

# (client, title, type, state, prio, msOwner, clientOwner, tags, days_created,
#  days_changed, extras)
RAW = [
    # ---------------- NORTHWIND TRADERS ----------------
    ("northwind", "Teams Phone migration - wave 3 cutover", "User Story", "In Progress", "1",
     "Alex Moreau", "Dana Whitfield", ["teams", "voice", "wave-3"], 42, 1,
     dict(dueDate=(NOW + timedelta(days=9)).date().isoformat(), meetingStatus="Scheduled",
          storyPoints="8", valueArea="Business",
          description="Cut over the remaining 4,200 seats in EMEA. Wave 2 completed with a 0.4% failure rate; wave 3 doubles the user count.",
          acceptance="All EMEA sites dialling out on Teams Phone; no P1 voice incidents for 5 business days post-cutover.")),
    ("northwind", "Intune compliance policy baseline not applying to macOS", "Bug", "Active", "1",
     "Riley Chen", "Owen Drake", ["intune", "macos", "compliance"], 21, 0,
     dict(cssCase=True, cssCaseNumber="2609080040001234", escalatedTo=["PG"],
          escalationStatus="submitted", meetingStatus="N/A", risk="1 - High",
          description="macOS devices report Compliant while the disk-encryption rule is unevaluated. 900 devices affected. Reproduced in the customer tenant and in a clean lab tenant.")),
    ("northwind", "Autopatch readiness assessment", "User Story", "Resolved", "2",
     "Alex Moreau", "Dana Whitfield", ["autopatch", "assessment"], 74, 12,
     dict(storyPoints="5", valueArea="Architectural", meetingStatus="N/A",
          description="Ran the readiness assessment across 12 device groups. Two blockers found: legacy AV exclusions and an unsupported servicing ring.")),
    ("northwind", "Quarterly service review - Q3", "Meeting", "Closed", "2",
     "Alex Moreau", "Dana Whitfield", ["qsr", "governance"], 96, 20,
     dict(meetingStatus="N/A",
          description="Delivered. Availability 99.98%, two SEVs reviewed, roadmap for Copilot pilot agreed.")),
    ("northwind", "Copilot readiness - licence and data governance gap review", "Task", "Active", "2",
     "Taylor Nkemdirim", "Nadia Fournier", ["copilot", "governance"], 30, 4,
     dict(meetingStatus="Scheduling", valueArea="Business",
          description="Review oversharing risk in SharePoint before the Copilot pilot. Customer has 1,900 sites with broad permissions.")),
    ("northwind", "Conditional Access break-glass account audit", "Task", "Closed", "3",
     "Jordan Reyes", "Owen Drake", ["identity", "conditional-access"], 118, 12,
     dict(meetingStatus="N/A",
          description="Confirmed two break-glass accounts excluded from all CA policies and monitored by an alert rule.")),
    ("northwind", "Wave 4 scoping workshop", "Meeting", "New", "3",
     "Alex Moreau", "Dana Whitfield", ["teams", "voice", "wave-4"], 5, 5,
     dict(meetingStatus="Scheduling",
          description="Scope APAC sites. Waiting on the customer to confirm site contacts.")),
    ("northwind", "Legacy AV exclusions blocking Defender onboarding", "Risk", "Active", "2",
     "Riley Chen", "Owen Drake", ["defender", "risk"], 63, 9,
     dict(risk="2 - Medium", escalatedTo=["CSAM"], escalationStatus="on-hold",
          meetingStatus="N/A",
          description="Third-party AV still present on 400 servers. Owner identified but change window not yet booked.")),

    # ---------------- CONTOSO FINANCIAL GROUP ----------------
    ("contoso-financial", "Entra ID Conditional Access redesign", "User Story", "In Progress", "1",
     "Jordan Reyes", "Marcus Bell", ["identity", "entra", "conditional-access"], 55, 0,
     dict(storyPoints="13", valueArea="Architectural", meetingStatus="Scheduled",
          dueDate=(NOW + timedelta(days=21)).date().isoformat(),
          description="Consolidate 47 overlapping CA policies into a 9-policy persona model. Regulator requires documented evidence of least privilege.",
          acceptance="Policy count under 12, every policy mapped to a persona, report-only run clean for 14 days.")),
    ("contoso-financial", "Exchange Online transport rule causing NDRs for external partners", "Bug", "Active", "1",
     "Sam Okafor", "Lena Vasquez", ["exchange", "mailflow"], 11, 0,
     dict(cssCase=True, cssCaseNumber="2609080040005678", escalatedTo=["PM", "PG"],
          escalationStatus="submitted", dcr=True, dcrId="DCR-24817",
          dcrStatus="in progress", risk="1 - High", meetingStatus="Scheduled",
          description="A transport rule added during the DLP rollout rejects signed mail from three custody partners. Business impact: settlement confirmations delayed.")),
    ("contoso-financial", "DLP policy tuning - false positive rate above threshold", "Task", "In Progress", "2",
     "Sam Okafor", "Lena Vasquez", ["purview", "dlp"], 38, 2,
     dict(dcr=True, dcrId="DCR-24655", dcrStatus="submitted", meetingStatus="N/A",
          description="False positives at 18% against a 5% target. Tuning the credit-card and account-number classifiers.")),
    ("contoso-financial", "Regulatory evidence pack for Q4 audit", "Milestone", "New", "1",
     "Jordan Reyes", "Marcus Bell", ["audit", "compliance", "milestone"], 8, 3,
     dict(dueDate=(NOW + timedelta(days=45)).date().isoformat(), meetingStatus="Scheduling",
          valueArea="Business",
          description="Assemble CA policy exports, sign-in log retention proof, and privileged access review records.")),
    ("contoso-financial", "Privileged Identity Management rollout", "User Story", "Resolved", "2",
     "Jordan Reyes", "Marcus Bell", ["identity", "pim"], 87, 16,
     dict(storyPoints="8", valueArea="Architectural", meetingStatus="N/A",
          description="All 62 Global Admin assignments converted to eligible with approval workflow.")),
    ("contoso-financial", "Resourcing gap - no dedicated Purview engineer", "Risk", "Active", "2",
     "Sam Okafor", "", ["resourcing", "risk"], 26, 7,
     dict(escalatedTo=["Resourcing", "Manager"], escalationStatus="submitted",
          risk="2 - Medium", meetingStatus="N/A",
          description="DLP tuning is consuming support hours not covered by the package. Raised with the manager and resourcing.")),
    ("contoso-financial", "Monthly technical sync", "Meeting", "Active", "3",
     "Sam Okafor", "Lena Vasquez", ["cadence"], 120, 1,
     dict(meetingStatus="Scheduled",
          description="Recurring. Standing agenda: open cases, change calendar, roadmap items.")),
    ("contoso-financial", "Tenant-to-tenant migration feasibility for acquired entity", "Task", "New", "3",
     "Taylor Nkemdirim", "Marcus Bell", ["migration", "discovery"], 4, 4,
     dict(meetingStatus="TBR",
          description="Acquisition closes in Q1. Session was booked then pulled - needs rescheduling once the deal is public.")),
    ("contoso-financial", "SharePoint search index rebuild after schema change", "Task", "Closed", "3",
     "Taylor Nkemdirim", "Lena Vasquez", ["sharepoint"], 143, 28,
     dict(meetingStatus="N/A", description="Rebuild completed over a weekend window. No user impact reported.")),

    # ---------------- FABRIKAM HEALTH SYSTEMS ----------------
    ("fabrikam-health", "Contract renewal - 90 day checkpoint", "Milestone", "Active", "1",
     "Taylor Nkemdirim", "Priya Raman", ["renewal", "milestone"], 14, 0,
     dict(dueDate=(NOW + timedelta(days=30)).date().isoformat(), meetingStatus="Scheduled",
          valueArea="Business", escalatedTo=["CSAM"], escalationStatus="submitted",
          description="Package expires 30 Nov 2026. Build the value story: 3 SEVs avoided, 2 major migrations delivered.")),
    ("fabrikam-health", "Defender for Endpoint onboarding - clinical workstations", "User Story", "In Progress", "1",
     "Riley Chen", "Priya Raman", ["defender", "mde", "clinical"], 49, 1,
     dict(storyPoints="13", meetingStatus="Scheduled", risk="1 - High",
          dueDate=(NOW + timedelta(days=16)).date().isoformat(),
          description="6,000 clinical endpoints, many running vendor-locked imaging software. Cannot reboot during clinical hours.",
          acceptance="95% onboarded and reporting; zero clinical application regressions.")),
    ("fabrikam-health", "Imaging vendor software incompatible with ASR rules", "Bug", "Active", "1",
     "Riley Chen", "Hugo Lindqvist", ["defender", "asr", "vendor"], 19, 2,
     dict(cssCase=True, cssCaseNumber="2609080040009012", escalatedTo=["PG"],
          escalationStatus="on-hold", dcr=True, dcrId="DCR-24902",
          dcrStatus="escalated", risk="1 - High", meetingStatus="Scheduled",
          description="ASR rule 'Block Office from creating child processes' breaks the PACS viewer. Exclusion requested; PG assessing a targeted fix.")),
    ("fabrikam-health", "Windows 11 upgrade readiness - clinical fleet", "User Story", "Active", "2",
     "Alex Moreau", "Hugo Lindqvist", ["windows-11", "upgrade"], 67, 5,
     dict(storyPoints="8", meetingStatus="Scheduling", valueArea="Architectural",
          description="2,400 devices below the CPU requirement. Building the replace-vs-extend model with the customer.")),
    ("fabrikam-health", "MDE training for Windows and Linux teams", "Task", "Closed", "2",
     "Riley Chen", "Hugo Lindqvist", ["training", "mde"], 101, 25,
     dict(meetingStatus="N/A",
          description="Four sessions delivered. Feedback 4.6/5. Follow-up cadence still to be agreed.")),
    ("fabrikam-health", "Establish proactive engagement cadence", "Task", "New", "2",
     "Riley Chen", "Hugo Lindqvist", ["cadence", "proactive"], 33, 11,
     dict(meetingStatus="TBR",
          description="Agreed in principle after training. Chased three times, no date confirmed - candidate for escalation.")),
    ("fabrikam-health", "Backup and recovery review for Exchange hybrid", "Task", "Resolved", "3",
     "Sam Okafor", "Priya Raman", ["exchange", "hybrid", "backup"], 79, 24,
     dict(meetingStatus="N/A", description="Documented RPO/RTO for the hybrid estate. Two gaps closed.")),
    ("fabrikam-health", "Nurse workstation single sign-on latency", "Bug", "Closed", "3",
     "Jordan Reyes", "Hugo Lindqvist", ["identity", "sso", "performance"], 131, 95,
     dict(meetingStatus="N/A",
          description="Root cause was an on-prem STS timeout. Resolved by moving to managed authentication.")),

    # ---------------- MY TEAM ----------------
    ("my-team", "Publish team runbook for on-call handover", "Task", "In Progress", "2",
     "Alex Moreau", "", ["internal", "runbook"], 22, 2,
     dict(meetingStatus="N/A",
          description="Standardise the handover note so the incoming engineer has context without a call.")),
    ("my-team", "Team offsite planning", "Meeting", "Active", "3",
     "Taylor Nkemdirim", "", ["internal", "offsite"], 17, 6,
     dict(meetingStatus="Scheduling", description="Half-day in-person. Agenda ideas being collected.")),
    ("my-team", "Rotate demo tenant credentials", "Task", "New", "2",
     "Jordan Reyes", "", ["internal", "security"], 3, 3,
     dict(dueDate=(NOW + timedelta(days=7)).date().isoformat(), meetingStatus="N/A",
          description="Quarterly rotation for the shared demo tenant.")),
    ("my-team", "Retro - Q3 delivery", "Meeting", "Closed", "3",
     "Alex Moreau", "", ["internal", "retro"], 58, 9,
     dict(meetingStatus="N/A", description="Three actions carried forward into Q4.")),

    # ---------------- MANAGER 1:1 ----------------
    ("manager-1-1", "Career conversation - architect track", "Task", "Active", "2",
     "Alex Moreau", "", ["1-1", "career"], 45, 8,
     dict(meetingStatus="Scheduled",
          description="Discuss the path to principal. Bring evidence from the last two engagements.")),
    ("manager-1-1", "Raise resourcing pressure on regulated accounts", "Task", "In Progress", "1",
     "Alex Moreau", "", ["1-1", "resourcing"], 26, 1,
     dict(escalatedTo=["Manager"], escalationStatus="submitted", meetingStatus="Scheduled",
          description="Two accounts consuming hours beyond package scope. Need a decision on additional cover.")),
    ("manager-1-1", "Mid-year Connect draft review", "Milestone", "Closed", "2",
     "Alex Moreau", "", ["1-1", "connect"], 92, 70,
     dict(meetingStatus="N/A", description="Draft reviewed and submitted.")),

    # ---------------- MYLEARNING ----------------
    ("mylearning", "SC-100 Cybersecurity Architect certification", "Milestone", "In Progress", "1",
     "Alex Moreau", "", ["learning", "certification"], 61, 3,
     dict(dueDate=(NOW + timedelta(days=38)).date().isoformat(), meetingStatus="N/A",
          storyPoints="13", description="Exam booked. Weakest area is hybrid identity - two labs remaining.")),
    ("mylearning", "Hands-on lab - Autopatch in a test tenant", "Task", "Active", "2",
     "Alex Moreau", "", ["learning", "autopatch", "lab"], 29, 4,
     dict(meetingStatus="N/A",
          description="Build a ring structure end to end so the customer conversation is grounded in practice.")),
    ("mylearning", "Purview DLP deep dive series", "Task", "New", "3",
     "Alex Moreau", "", ["learning", "purview"], 9, 9,
     dict(meetingStatus="N/A", description="Six-part internal series. Directly relevant to the Contoso DLP work.")),
    ("mylearning", "AZ-500 renewal assessment", "Task", "Closed", "2",
     "Alex Moreau", "", ["learning", "certification"], 76, 17,
     dict(meetingStatus="N/A", description="Renewed for another 12 months.")),
    ("mylearning", "Present Defender XDR learnings at team huddle", "Task", "Resolved", "3",
     "Alex Moreau", "", ["learning", "sharing"], 40, 18,
     dict(meetingStatus="N/A", description="Delivered to the team; slides added to the shared library.")),
]

COMMENTS = {
    "Exchange Online transport rule causing NDRs for external partners": [
        ("Sam Okafor", 9, "Confirmed the rule was introduced in change CHG-4471. Rolled back in report-only while PG assesses."),
        ("Lena Vasquez", 6, "Partners have a manual workaround but it will not hold past month end."),
        ("Sam Okafor", 0, "DCR-24817 moved to in progress. Targeting a fix in the next service update."),
    ],
    "Imaging vendor software incompatible with ASR rules": [
        ("Riley Chen", 12, "Reproduced in the lab with the vendor's own installer. Not environment-specific."),
        ("Hugo Lindqvist", 5, "Clinical leadership will not accept a blanket exclusion. Needs a targeted rule."),
    ],
    "Teams Phone migration - wave 3 cutover": [
        ("Alex Moreau", 6, "Wave 2 retro complete. Two lessons applied: earlier number-porting checks and a longer soak period."),
        ("Dana Whitfield", 2, "Site contacts confirmed for all 14 EMEA locations."),
    ],
    "Entra ID Conditional Access redesign": [
        ("Jordan Reyes", 10, "Persona model agreed: workforce, privileged, external, service, break-glass."),
        ("Marcus Bell", 3, "Risk and compliance signed off on the report-only approach."),
    ],
    "Contract renewal - 90 day checkpoint": [
        ("Taylor Nkemdirim", 4, "Pulling delivery evidence now. Three avoided SEVs is the strongest line."),
    ],
    "Raise resourcing pressure on regulated accounts": [
        ("Alex Moreau", 1, "Bringing the hours breakdown to the next 1:1."),
    ],
}


def build():
    items = []
    order = {}
    for (cid, title, typ, state, prio, ms, co, tags, dc, dch, extra) in RAW:
        key = (cid, state)
        order[key] = order.get(key, -1) + 1
        it = {
            "id": stable_id(cid, title),
            "source": "manual",
            "clientId": cid,
            "type": typ,
            "state": state,
            "title": title,
            "assignedTo": ms,
            "clientOwner": co,
            "priority": prio,
            "tags": tags,
            "order": order[key],
            "comments": [],
            "archived": False,
            "storyPoints": "",
            "risk": "",
            "valueArea": "",
            "dueDate": "",
            "description": "",
            "acceptance": "",
            "escalatedTo": [],
            "escalationStatus": "",
            "cssCase": False,
            "cssCaseNumber": "",
            "dcr": False,
            "dcrId": "",
            "dcrStatus": "",
            "meetingStatus": "",
            "created": iso(dc),
            "changed": iso(dch),
            "createdBy": "Demo",
        }
        it.update(extra)
        for author, ago, text in COMMENTS.get(title, []):
            it["comments"].append({
                "id": stable_id(title, author, text, length=8),
                "author": author,
                "text": text,
                "created": iso(ago, hour=14),
            })
        items.append(it)

    clients = []
    for c in CLIENTS:
        base = {
            "id": "", "name": "", "packageName": "", "packageId": "", "status": "completed",
            "knowMeUrl": "", "contractEnd": "", "adoOrg": "", "adoProject": "",
            "notes": "", "archived": False, "clientLead": "", "clientLeadRole": "",
            "clientLeadEmail": "", "searchTerms": "", "scanEnabled": False,
            "scanRequested": False, "lastScan": "",
        }
        base.update(c)
        clients.append(base)

    return {"version": 1, "settings": SETTINGS, "clients": clients, "items": items}


def main():
    os.makedirs(DATA, exist_ok=True)
    store = build()
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE)

    with open(os.path.join(DATA, "proposals.json"), "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "proposals": []}, fh, indent=2)

    print(f"clients: {len(store['clients'])}")
    print(f"items  : {len(store['items'])}")
    for c in store["clients"]:
        n = len([i for i in store["items"] if i["clientId"] == c["id"]])
        print(f"  {c['name']:<28} {n}")


if __name__ == "__main__":
    main()

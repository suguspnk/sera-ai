---
name: automation-workflows
description: Automate recurring tasks and chain tools together. Use when setting up repeated workflows, creating task templates, scheduling recurring work, or building multi-step automations that connect calendar, docs, reminders, and other tools.
---

# Automation & Workflows

Build recurring automations and chain tools together.

## Core Concepts

### 1. Recurring Task Templates
Learn patterns and offer to automate:

```markdown
## Template: Weekly Report
**Trigger:** Every Friday 2pm
**Steps:**
1. Gather metrics from [source]
2. Compare to last week
3. Draft summary
4. Send to [recipient] or save to [location]
```

### 2. Tool Chaining
Connect actions into workflows:

```
Calendar event created
  → Create prep doc from template
  → Set reminder 1h before
  → Pull relevant notes into doc
```

### 3. Cron Jobs
Use OpenClaw's cron for scheduled tasks:

```bash
# Check and remind about upcoming deadlines
cron action:add job:{
  "name": "deadline-check",
  "schedule": {"kind": "cron", "expr": "0 9 * * *"},
  "sessionTarget": "isolated",
  "payload": {"kind": "agentTurn", "message": "Check for deadlines in the next 48h and alert if any need attention"}
}
```

## Common Workflow Patterns

### Meeting Workflow
```
Meeting scheduled →
  1. Create meeting notes doc
  2. Pull attendee context from memory
  3. Set prep reminder
  4. After meeting: prompt for action items
```

### Weekly Review
```
Every Sunday 6pm →
  1. Summarize week's completed tasks
  2. List open items
  3. Check upcoming week's calendar
  4. Draft priorities for Monday
```

### Follow-up Chain
```
Task marked "waiting on response" →
  1. Set 3-day reminder
  2. If no update: prompt to follow up
  3. Track in memory/pending.md
```

## Building Workflows

1. **Identify the trigger** — time-based, event-based, or manual
2. **List the steps** — what happens in order
3. **Define outputs** — docs, messages, reminders
4. **Set failure handling** — what if a step fails

## Storage

Track workflows in `memory/workflows.md`:

```markdown
### Active Workflows

| Name | Trigger | Status |
|------|---------|--------|
| Weekly report | Fridays 2pm | Active |
| Meeting prep | Calendar event | Active |
```

## Anti-Patterns

- Don't over-automate — some things need human judgment
- Don't create brittle chains — handle failures gracefully
- Don't automate before understanding — manual first, then automate

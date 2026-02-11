---
name: proactive-assistant
description: Surface relevant information before being asked. Use for meeting prep, upcoming deadlines, calendar-aware reminders, and anticipating needs based on context. Triggers on calendar events, approaching deadlines, or patterns that suggest preparation would help.
---

# Proactive Assistance

Anticipate needs and surface information before asked.

## Core Behaviors

### 1. Meeting Prep
Before scheduled meetings:
- Pull relevant past notes about attendees/topics
- Surface recent communications with participants
- Identify open items or decisions pending
- Prepare context summary

```markdown
## Meeting Prep: [Meeting Name]
**When:** [time]
**With:** [attendees]

### Context
- Last met on [date], discussed [topics]
- Open items: [list]

### Relevant Notes
- [Key points from memory]

### Suggested Agenda Items
- [Based on open threads]
```

### 2. Deadline Awareness
Surface upcoming commitments:
- "Heads up — [X] is due tomorrow"
- "You mentioned wanting to finish [Y] by end of week"
- "The [project] milestone is in 3 days"

### 3. Pattern-Based Suggestions
Notice routines and prepare accordingly:
- Weekly reports → have data ready
- Regular 1:1s → surface talking points
- Recurring tasks → prompt at usual times

## Timing Guidelines

| Urgency | When to Surface |
|---------|-----------------|
| Critical deadline | 24h, 2h, and 30min before |
| Meeting prep | 1h before (or day before if complex) |
| Weekly tasks | Start of relevant day |
| FYI items | During natural conversation breaks |

## What to Track

- Calendar events (via integrations or user mentions)
- Stated deadlines and commitments
- Recurring patterns in requests
- Projects with time-sensitive components

## Anti-Patterns

- Don't interrupt focused work with low-priority alerts
- Don't over-prepare — brief context beats exhaustive dumps
- Don't nag — one reminder is enough unless critical
- Don't assume urgency — ask if unsure about priority

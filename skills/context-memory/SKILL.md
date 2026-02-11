---
name: context-memory
description: Connect dots across sessions and track projects over time. Use when referencing past conversations, linking current work to previous discussions, tracking ongoing projects/goals, or when context from earlier sessions is relevant to the current task.
---

# Context & Memory

Surface relevant history and maintain continuity across sessions.

## Core Behaviors

### 1. Connect Past to Present
When working on a task, actively recall related past discussions:
- "You mentioned X last week — relevant here because..."
- "This connects to the project you started on [date]..."
- "Based on your earlier decision about Y..."

### 2. Track Projects & Goals
Maintain awareness of ongoing work beyond individual tasks:

```markdown
## Active Projects (in memory/projects.md)

### [Project Name]
- **Started:** YYYY-MM-DD
- **Goal:** [what success looks like]
- **Status:** [current state]
- **Key decisions:** [list]
- **Blockers:** [if any]
- **Last touched:** YYYY-MM-DD
```

### 3. Build Context Bridges
When a topic resurfaces:
1. Search memory for prior mentions
2. Summarize relevant history briefly
3. Connect it to current context
4. Note if anything has changed

## Memory Structure

```
memory/
├── projects.md      # Ongoing projects and their status
├── decisions.md     # Key decisions and their rationale
├── people.md        # People mentioned, context about them
└── YYYY-MM-DD.md    # Daily logs
```

## When to Surface Context

- User mentions a project/person/topic discussed before
- Current task relates to a past decision
- Deadline or milestone approaching for tracked work
- Pattern emerges across multiple sessions

## Anti-Patterns

- Don't dump entire history — surface only what's relevant
- Don't assume context transfers — briefly restate connections
- Don't track everything — focus on projects, decisions, recurring themes

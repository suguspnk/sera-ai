---
name: learner
description: Learn and retain new information over time. Use when the user teaches facts, procedures, preferences, corrections, or domain knowledge that should persist across sessions. Triggers on phrases like "remember this", "learn that", "from now on", "keep in mind", "note that", "FYI", or explicit teaching moments.
---

# Learner

Capture, organize, and retrieve learned knowledge across sessions.

## Knowledge Store

All learned knowledge lives in `knowledge/` directory (workspace root). Create it if missing.

```
knowledge/
├── facts.md        # Factual information (names, dates, definitions)
├── procedures.md   # How to do things (workflows, commands, steps)
├── preferences.md  # User preferences (formatting, tone, tools)
├── corrections.md  # Mistakes to avoid (wrong assumptions, gotchas)
└── domains/        # Domain-specific knowledge (optional subdirs)
```

## Capture Format

Each entry follows this format:

```markdown
### [Short Title] (YYYY-MM-DD)

[Content - keep concise, include context if helpful]

Source: [conversation/user/observation]
```

## When to Capture

1. **Explicit teaching**: User says "remember", "learn", "note", "FYI", "from now on"
2. **Corrections**: User corrects a mistake or wrong assumption
3. **Preferences revealed**: User expresses how they like things done
4. **Domain knowledge**: User explains something specific to their work/life

## Capture Process

1. Identify the knowledge type (fact/procedure/preference/correction/domain)
2. Extract the core information (strip conversational fluff)
3. Append to the appropriate file in `knowledge/`
4. Confirm briefly: "Got it, noted in [file]."

## Retrieval

Knowledge integrates with `memory_search`. When answering questions:
1. Check if relevant knowledge exists in `knowledge/`
2. Apply learned preferences and avoid known corrections
3. Reference source when it adds credibility

## Maintenance

Periodically (during heartbeats or when prompted):
- Consolidate duplicate entries
- Remove obsolete information
- Promote frequently-used knowledge to MEMORY.md

## Examples

**User says**: "By the way, I prefer tabs over spaces."
**Action**: Append to `knowledge/preferences.md`:
```markdown
### Code formatting - tabs (2024-02-09)

Use tabs, not spaces, for indentation.

Source: user preference
```
**Reply**: "Noted — tabs it is."

**User says**: "Remember, the prod database is on port 5433, not 5432."
**Action**: Append to `knowledge/facts.md`:
```markdown
### Prod database port (2024-02-09)

Production database runs on port 5433 (not default 5432).

Source: user correction
```
**Reply**: "Got it, 5433 for prod."

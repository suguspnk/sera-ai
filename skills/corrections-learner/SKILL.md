---
name: corrections-learner
description: >
  Auto-document mistakes and corrections to prevent repeating them.
  Triggers when user says "that's wrong", "no actually", "you messed up",
  "don't do that", "I told you before", "wrong", "incorrect", corrects
  your output, expresses frustration with repeated mistakes, or provides
  any form of correction or feedback about your behavior or output.
---

# Corrections Learner

When you receive a correction, document it immediately so you don't repeat the mistake.

## Detection

Recognize corrections from phrases like:
- "That's wrong" / "No, actually" / "Incorrect"
- "You messed up" / "Don't do that again"
- "I already told you" / "I said before"
- "Stop doing X" / "Always do Y instead"
- Direct fixes to your output
- Frustrated repetition of instructions

## Workflow

1. **Acknowledge** — Own the mistake briefly, no excuses
2. **Clarify** — If ambiguous, confirm what went wrong
3. **Document** — Write to `memory/corrections.md` immediately
4. **Apply** — Follow the correction in your current response

## Documentation Format

Append to `memory/corrections.md`:

```markdown
## YYYY-MM-DD: [Short title]

**Wrong:** [What you did incorrectly]
**Right:** [What you should do instead]
**Context:** [When this applies]
```

Example:

```markdown
## 2026-02-10: Discord table formatting

**Wrong:** Used markdown tables in Discord messages
**Right:** Use bullet lists instead — Discord doesn't render tables
**Context:** Any Discord channel output
```

## On Session Start

When loading memory files, also check `memory/corrections.md` and keep documented corrections in mind.

## Principles

- Document immediately, don't wait
- Be specific — vague corrections are useless
- Include context for when the rule applies
- If a correction contradicts an earlier one, update the old entry
- Patterns matter more than one-offs — if corrected twice, definitely document

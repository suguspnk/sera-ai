---
name: ml-research
description: ML/AI research skill for theoretical foundations and paper reading. Use when exploring machine learning theory, reading academic papers, tracking research progress, finding key papers, understanding mathematical foundations, or building research habits in ML/AI/theory.
---

# ML Research Skill

Structured approach to ML/AI research with emphasis on theoretical foundations.

## Workspace

Research files live in `knowledge/research/`:
- `reading-log.md` — papers read with dates, notes, key takeaways
- `reading-queue.md` — papers to read, prioritized
- `concepts.md` — theoretical concepts being learned
- `reproductions.md` — papers reproduced from scratch

Create these files on first use.

## Paper Reading Workflow

1. **Select paper** from queue or search
2. **First pass** (5-10 min): Title, abstract, intro, conclusion, skim figures
3. **Second pass** (1 hr): Read carefully, skip proofs
4. **Third pass** (4-5 hr): Understand proofs, attempt to reproduce key results
5. **Log it** in `reading-log.md` with date, citation, and 2-3 sentence summary

## Finding Papers

**Key venues:**
- Theory-heavy: COLT, STOC, FOCS
- ML conferences: NeurIPS, ICML, ICLR
- Journals: JMLR, IEEE TPAMI

**Search:**
- Semantic Scholar, arXiv, Google Scholar
- Follow citation graphs from foundational papers

## Core References

See `references/foundations.md` for:
- Essential textbooks
- Foundational papers by topic
- Mathematical prerequisites

See `references/open-problems.md` for:
- Active research directions
- Theory-practice gaps worth exploring

## Logging Format

```markdown
## YYYY-MM-DD: [Paper Title]
**Authors:** ...
**Venue:** ...
**Key idea:** One sentence
**Notes:** 2-3 sentences on what you learned
**Rating:** ★★★★☆
```

## Reproduction Practice

For deep understanding, implement papers from scratch:
1. Pick a paper with clear algorithms
2. Implement without looking at existing code
3. Reproduce key figures/tables
4. Document struggles in `reproductions.md`

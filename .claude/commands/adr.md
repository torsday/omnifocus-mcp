---
description: Write an ADR for this project — correct numbering, filename, and cross-reference format. Specialized over the global /adr.
---

Write an Architecture Decision Record for the decision described in the user's request, tailored to this project's conventions.

**Start by following the canonical ADR protocol** at `~/src/github.com/torsday/llm_prompts/adr.md` for format, standards, and when-to-write guidance. Then layer on the following project-specific rules.

## Project-specific rules

### File location and naming

- Store under `docs/adr/`
- Filename: `NNNN-short-kebab-title.md` (e.g. `0014-stdio-framing.md`)
- **Numbering:** next ADR number is one higher than the highest-numbered existing file in `docs/adr/`. Verify with: `ls docs/adr/ | sort -n | tail -1`

### Cross-references to update after writing

- `DESIGN.md` — if the ADR locks in a decision discussed in a specific section, add a cross-ref in that section (and in §11 "Cross-references")
- `CLAUDE.md` — if the ADR belongs in the "Reference docs" ADR index, add it in numeric order
- `README.md` — the ADR table in the "Design documents" section
- Related ADRs — if this supersedes or depends on another, add a reference line in both

### Standard front-matter

Every ADR in this project follows the same header shape:

```markdown
# ADR-NNNN: <title — short noun phrase describing the decision>

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNNN

---
```

### Project-specific thinking

When evaluating options for this project, the relevant axes are usually:

- **JXA vs OmniJS** — does this decision favor one transport, or both? (See ADR-0002)
- **Public contract impact** — does it change tool names, schemas, envelope, or error codes? If yes, the ADR must note the semver implications (ADR-0011).
- **Adapter seam preserved?** — does the decision respect the `OmniFocusAdapter` boundary, or does it leak transport concerns up?
- **Agent-friendliness** — does the decision make tools easier or harder for LLMs to pick correctly? (agent_systems.md "rich responses, actionable errors")

### After writing

Verify the ADR is complete:

- Title is a short noun phrase, not a sentence
- Options table shows 2–4 realistic alternatives with honest pros/cons
- Consequences section names both Positive and Negative; includes Risks with mitigations
- References link the DESIGN sections, SPEC requirements, or prior-art docs that drove the decision

Then:

- Commit as `docs(adr): add ADR-NNNN — <short-title>` per `commit.md`
- If the ADR changes direction on a load-bearing decision (supersedes an existing ADR), mark the old one **Superseded by ADR-NNNN** and commit that change separately.

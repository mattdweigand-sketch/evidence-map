---
title: "Stop Asking AI To Make A Deck: The Practical Guide To AI With Excel And PowerPoint"
type: "guide"
label: "Guide"
project: "AI Office Files Truth Workflow"
---

# Stop Asking AI To Make A Deck: The Practical Guide To AI With Excel And PowerPoint

# Stop Asking AI To Make A Deck: The Practical Guide To AI With Excel And PowerPoint

The old question was whether AI could make Office files. It can. It can draft a workbook, render a slide deck, summarize a folder, and turn a rough prompt into something that looks much closer to finished work than a blank PowerPoint or empty spreadsheet ever did.

The new question is whether AI can handle the parts of Excel and PowerPoint that make real work painful: messy data, wrong formulas, brand constraints, missing sources, recurring reporting cycles, and executive-ready judgment.

This guide is the practical layer under the article. The point is not to ask AI for prettier files. The point is to make repeatable Office workflows that keep the truth visible while the file gets built.

Use this when the file will travel: a board deck, investor update, QBR, budget, operating model, client presentation, campaign report, regulatory response, or any spreadsheet where a number can become a decision.

---

## The Pain Map

### 1. Wrong formulas that look plausible

Excel does not always scream when a model is wrong. A formula can point to the wrong cells, a projection can be hardcoded, or a calculated row can copy the same reference across every year. The workbook still opens. The outputs still look polished. The danger is subtle failure that survives review.

The fix is not a better one-line formula prompt. The fix is to make AI inspect the workbook, map assumptions, identify formula risk, and produce a verification memo before anyone trusts the output.

### 2. Messy workbooks break the magic

AI works best on clean tables with unique headers, consistent formatting, clear date fields, and no mystery structure. Real business exports are full of merged headers, empty rows, hidden tabs, text stored as numbers, stale sheets, duplicate rows, and undocumented assumptions.

The fix is to normalize and reconcile before asking for insight. Clean the work surface first.

### 3. PowerPoint brand drift

Most people do not need a generic AI deck. They need a deck that obeys the actual company template: masters, layouts, fonts, colors, chart styles, legal copy, spacing, density, and the strange institutional rules that make a deck acceptable.

The fix is to make AI inspect the brand system before slide generation. Teach it the template, then ask it to render.

### 4. Rough decks are not enough

AI slides are often useful for internal sketching but not client-ready, event-ready, or executive-ready. The missing piece is not only design polish. It is hierarchy, source discipline, claim structure, and consistency.

The fix is to separate story architecture from slide production. First build the argument. Then render the deck.

### 5. People want audit trails

For Excel, readers need row-level evidence, formula explanations, assumptions, and checks. For PowerPoint, they need every claim and number tied back to a source. Without that, AI creates review burden instead of leverage.

The fix is an evidence map and a hostile review pass.

### 6. The real job is cross-app

The valuable workflow is not simply "make a file." It is Excel data to analysis, analysis to narrative, narrative to deck, deck to revision, and revision to next month's recurring update.

The fix is to think in primitives, not prompts.

---

## The Primitive Model

Do not treat AI like a file generator. Treat Office work as a set of repeatable primitives. Each primitive has an input, output, validation rule, and failure mode.

1. **Inspect**: Map files, sheets, masters, formulas, sources, assumptions, and constraints.
2. **Normalize**: Clean labels, dates, units, categories, headers, formats, and table structure.
3. **Reconcile**: Compare sources, preserve conflicts, and produce an audit trail.
4. **Model**: Build linked calculations, assumptions, scenarios, checks, and documentation.
5. **Narrate**: Turn analysis into a decision story for a named audience and business moment.
6. **Render**: Create the workbook, slide deck, charts, visuals, and layout from the approved spec.
7. **Verify**: Check formulas, numbers, claims, layout, readability, contrast, and source match.
8. **Update**: Refresh last month's artifact without destroying structure, prior decisions, or the review trail.

The production bottleneck moved. File creation got easier. Judgment, verification, and workflow design got more valuable.

---

# Prompt Kit 1: Workbook Doctor

## Job

Audit an inherited, messy, or AI-generated workbook before anyone trusts it. Use this before asking AI to build a model, repair a model, summarize a workbook, or pull executive findings out of Excel.

## Use When

- The workbook has hidden tabs, merged headers, unclear formulas, hardcoded outputs, or stale data.
- You inherited the file and do not know how it works.
- AI generated a workbook that looks polished but may not recalculate.
- A number from the workbook will appear in a deck, memo, or decision.

## Prompt 1: Workbook Map

```prompt
You are a senior spreadsheet reviewer. Your job is to inspect this workbook before any analysis, editing, or conclusions are made.

Create a workbook map with these sections:

1. Sheet inventory
- Sheet name
- Apparent purpose
- Whether it looks like raw data, assumptions, calculations, outputs, checks, documentation, or unused material
- Whether the sheet appears current, stale, duplicate, or unclear
- Any hidden, empty, protected, or suspicious sheets

2. Data structure review
- Tables or ranges used
- Header quality
- Blank rows or columns
- Merged cells
- Dates stored as text
- Numbers stored as text
- Mixed units or currencies
- Duplicate rows
- Fields that need human clarification

3. Formula map
- Which sheets contain formulas
- Key formulas or formula patterns
- Areas with hardcoded values where formulas are expected
- Formula inconsistency across parallel rows or columns
- Broken references, errors, circular references, or suspicious repeated references

4. Assumption map
- Every assumption you can identify
- Where it lives
- Whether it has a source, owner, date, unit, and status
- Whether it appears to be a fact, estimate, placeholder, or unsupported judgment

5. Risk summary
- Top risks before using this workbook
- Items requiring human review
- Questions I need answered before relying on the workbook

Do not fix the workbook yet. Do not summarize business conclusions yet. Only inspect and map it.
```

## Prompt 2: Formula Risk Scan

```prompt
Act as a skeptical Excel model reviewer. Inspect the workbook for formula and calculation risk.

Flag:
- Formulas copied inconsistently across parallel rows or columns
- Formulas that point to fixed cells when they should roll forward
- Hardcoded numbers inside calculation zones
- Outputs that do not change when assumptions change
- Missing or weak tie-outs
- Error values
- Hidden dependencies
- Stale date ranges
- Units, percentages, or currencies mixed together
- Any calculation that appears mathematically valid but logically suspicious

For every issue, return a table:
- Location
- Issue type
- Why it matters
- Evidence
- Suggested repair
- Human review needed? yes/no

Do not rewrite the workbook. Enumerate the issues first.
```

## Prompt 3: Repair Plan

```prompt
Using the workbook map and formula risk scan, create a repair plan.

Organize the plan into:
1. Must fix before sharing
2. Should fix for maintainability
3. Optional polish
4. Questions for the human owner

For each repair, explain:
- What should change
- Why it should change
- Which sheets/cells are affected
- How to verify the repair worked

Do not make final business claims until the must-fix items are resolved.
```

## Prompt 4: Final Verification Memo

```prompt
Review the repaired workbook as if it is about to be used in a board deck or executive decision.

Produce a verification memo with:
- What changed
- What was checked
- Which assumptions remain active
- Which outputs depend on which assumptions
- Which source data drives the key outputs
- Known limitations
- Remaining human-review items
- A pass/fail status for: formula consistency, source traceability, assumptions, checks, stale data, and output reliability

If anything important remains unresolved, do not call the workbook ready.
```

## Safe To Use Checklist

- Every key output traces back to raw data or labeled assumptions.
- Calculated outputs use formulas, not unexplained hardcodes.
- Formula patterns are consistent across comparable rows and columns.
- Assumptions have owner, date, unit, and status.
- Checks tab exists or a verification memo covers tie-outs and failures.
- Any unresolved issue is visible instead of buried.

---

# Prompt Kit 2: Deck Architect + Brand Validator

## Job

Convert analysis into a PowerPoint narrative before slide generation, then validate the finished deck against the source material and brand system.

## Use When

- The deck needs to drive a decision, not just summarize facts.
- The company has a real template or brand standard.
- A spreadsheet, memo, or research packet needs to become an executive story.
- You need client-safe or board-safe output.

## Prompt 1: Deck Architecture

```prompt
You are a senior presentation strategist. Do not create slides yet.

Build a deck architecture for this material.

First, define:
- Audience
- Decision or action the deck must support
- What the audience already knows
- What the audience must believe by the end
- One-sentence narrative spine
- Primary risk if the deck is misunderstood

Then create a slide map with one row per slide:
- Slide number
- Claim headline, written as a sentence, not a topic
- Role in the argument
- Supporting evidence or source IDs
- Chart/table/visual needed
- Assumptions
- Open questions
- Speaker note requirements
- Review status

Rules:
- No generic section titles as slide headlines.
- Every number or claim must name a source or be marked unsupported.
- Do not render slides until this architecture is reviewed.
```

## Prompt 2: Brand System Interpreter

```prompt
You are inspecting a PowerPoint template or example deck so a new deck can follow the same system.

Extract practical brand and layout rules:
- Slide masters or layout types visible
- Typography hierarchy
- Color palette and usage rules
- Chart style
- Table style
- Logo/legal/footer rules
- Typical slide density
- Common page structures
- Image or icon style
- Banned or risky visual moves
- Accessibility concerns
- Examples of slides that should be copied as patterns

Return this as instructions another AI can follow when rendering new slides.

Do not invent brand rules. If something is unclear, mark it unclear.
```

## Prompt 3: Render Instructions

```prompt
Using the approved deck architecture and brand rules, create the PowerPoint deck.

Requirements:
- Preserve claim headlines from the approved slide map unless explicitly revised.
- Put source IDs, calculations, assumptions, and review notes in speaker notes.
- Keep charts traceable to their source data.
- Use the brand rules from the template inspection.
- Avoid generic AI slide language.
- Prioritize clear hierarchy over decoration.

At the end, provide a slide-by-slide creation report listing any deviations from the architecture or brand system.
```

## Prompt 4: Brand + Accuracy Validator

```prompt
Review this finished deck as a skeptical executive reviewer and brand reviewer.

Check each slide for:
- Claim headline is specific and decision-relevant
- Claim has source attribution
- Numbers match source material
- Charts are traceable to data
- Assumptions are labeled
- Speaker notes contain evidence, not generic reminders
- Slide follows the template and brand system
- Visual hierarchy is clear
- Slide is not overcrowded
- Text is readable
- Chart labels, legends, and units are clear
- Any legal, compliance, or sensitivity issue is visible

Return a table:
- Slide
- Issue
- Severity: must fix / should fix / polish
- Evidence
- Recommended repair

Do not rewrite the deck in this pass. Enumerate.
```

## Safe To Use Checklist

- The deck has a decision spine before it has slides.
- Each headline is a claim, not a topic.
- Every slide has sources or a visible unsupported flag.
- Speaker notes carry the evidence layer.
- Brand/template rules were inspected before rendering.
- A separate validation pass happened after rendering.

---

# Prompt Kit 3: Excel-To-Deck Evidence Map

## Job

Turn spreadsheet-backed analysis into a deck where every claim can be traced back to workbook tabs, cells, source files, assumptions, and review status.

## Use When

- A workbook becomes a board deck, QBR, investor update, campaign report, or client presentation.
- You need to review the deck without reverse-engineering the spreadsheet.
- Multiple sources, versions, or assumptions feed the final story.

## Prompt 1: Evidence Map Builder

```prompt
You are creating an evidence map between a workbook and a slide deck.

For every proposed slide claim, build a table with:
- Slide number
- Claim headline
- Workbook tab(s)
- Cell ranges, tables, or named outputs used
- Source file IDs behind the workbook data
- Calculation or transformation used
- Assumptions involved
- Date range
- Owner or source authority
- Review status: verified / needs review / unsupported / conflicting
- Notes for the reviewer

Rules:
- If a slide claim cannot be traced, mark it unsupported.
- If a number depends on an assumption, name the assumption.
- If two sources disagree, preserve the conflict instead of choosing silently.
- If the deck uses a chart, map the chart to the exact data behind it.
```

## Prompt 2: Evidence Gap Review

```prompt
Review the evidence map and find weak spots.

Flag:
- Claims with no source
- Numbers with no date
- Charts with unclear data
- Assumptions presented as facts
- Workbook outputs that do not tie to raw data
- Slides where speaker notes do not explain the evidence
- Claims that rely on stale or superseded sources
- Conflicts that require human judgment

Return the issues ranked by risk, with recommended fixes.
```

## Prompt 3: Speaker Notes Evidence Layer

```prompt
Using the evidence map, write speaker notes for each slide.

Each slide's notes must include:
- Claim
- Source IDs
- Calculation or transformation
- Assumptions
- Review status
- Open questions or limitations

Keep notes concise but audit-ready. Do not add unsupported claims.
```

## Safe To Use Checklist

- Every slide claim maps to evidence.
- Every important number has a date and source.
- Charts can be traced back to data.
- Assumptions are visible.
- Reviewer can audit the deck from the evidence map and speaker notes.

---

# Pretty-But-Wrong Detector

Use this after AI creates a workbook or deck. The goal is to catch the kind of mistake that looks fine until someone knowledgeable checks it.

```prompt
Read this deck or workbook as a skeptical reviewer who suspects every claim and every number.

For each slide or sheet, identify:
- Claims without source attribution
- Numbers without a date or source
- Charts whose underlying data is not traceable
- Formulas inconsistent across parallel rows or columns
- Hardcoded outputs where formulas are expected
- Assumptions presented as facts
- Stale or mixed date ranges
- Brand/template drift
- Low-contrast or unreadable charts
- Overcrowded slides
- Broken narrative logic
- Items requiring human judgment

Produce a written list of every issue found. Do not fix anything. Just enumerate.

Rank each issue as:
- Must fix before sharing
- Should fix before important review
- Polish
```

## Pretty-But-Wrong Checklist

- Does the output look polished before it proves its sources?
- Does every number know where it came from?
- Does every assumption say it is an assumption?
- Do formulas change when assumptions change?
- Do charts say what data they use?
- Does the deck follow the actual brand system?
- Can a reviewer find the evidence without asking the author?
- Would this survive being forwarded without context?

---

## The Operating Rule

Use AI everywhere in Office work, but do not let it hide the truth layer.

Every claim should know where it came from. Every calculation should know what it depends on. Every assumption should be labeled as one. The finished file should have a review trail.

That is the difference between an AI-generated Office file that looks done and one you can actually trust.

Related upstream workflow: Nate's source-prep guide, [Use AI to organize your project files before you ask it to write](https://natesnewsletter.substack.com/p/ai-organize-files-before-writing).

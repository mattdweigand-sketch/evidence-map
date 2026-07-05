# Stop Asking AI To Make A Deck: The Practical Guide To AI With Excel And PowerPoint

This guide captures the rationale behind Evidence Map. The deterministic checks from the original prompt kits now live in `src/verify/` and `src/inspect/`, and `docs/runbook.md` is the operating workflow.

The old question was whether AI could make Office files. It can draft a workbook, render a slide deck, summarize a folder, and turn a rough prompt into something that looks much closer to finished work than a blank PowerPoint or empty spreadsheet ever did.

The harder question is whether AI can handle the parts of Excel and PowerPoint that make real work risky: messy data, wrong formulas, brand constraints, missing sources, recurring reporting cycles, and executive-ready judgment.

Use this rationale when the file will travel: a board deck, investor update, QBR, budget, operating model, client presentation, campaign report, regulatory response, or any spreadsheet where a number can become a decision.

## The Pain Map

### 1. Wrong formulas that look plausible

Excel does not always scream when a model is wrong. A formula can point to the wrong cells, a projection can be hardcoded, or a calculated row can copy the same reference across every year. The workbook still opens and the outputs still look polished.

The fix is not a better one-line formula prompt. The fix is to inspect the workbook, map assumptions, identify formula risk, and produce a verification memo before anyone trusts the output.

### 2. Messy workbooks break the magic

AI works best on clean tables with unique headers, consistent formatting, clear date fields, and documented assumptions. Real exports often have merged headers, empty rows, hidden tabs, text stored as numbers, stale sheets, duplicate rows, and unclear structure.

The fix is to normalize and reconcile before asking for insight. Clean the work surface first.

### 3. PowerPoint brand drift

Most people do not need a generic AI deck. They need a deck that obeys the actual template: masters, layouts, fonts, colors, chart styles, legal copy, spacing, density, and institutional rules.

The fix is to inspect the brand system before rendering slides. Teach the template, then create the deck.

### 4. Rough decks are not enough

AI slides can be useful for internal sketching but still fail at client-ready, event-ready, or executive-ready work. The missing piece is not only design polish. It is hierarchy, source discipline, claim structure, and consistency.

The fix is to separate story architecture from slide production. First build the argument. Then render the deck.

### 5. People want audit trails

For Excel, readers need row-level evidence, formula explanations, assumptions, and checks. For PowerPoint, they need every claim and number tied back to a source. Without that, AI creates review burden instead of leverage.

The fix is an evidence map and a hostile review pass.

### 6. The real job is cross-app

The valuable workflow is not simply "make a file." It is Excel data to analysis, analysis to narrative, narrative to deck, deck to revision, and revision to next month's recurring update.

The fix is to think in primitives, not prompts.

## The Primitive Model

Do not treat AI like a file generator. Treat Office work as repeatable primitives. Each primitive has an input, output, validation rule, and failure mode.

1. **Inspect**: Map files, sheets, masters, formulas, sources, assumptions, and constraints.
2. **Normalize**: Clean labels, dates, units, categories, headers, formats, and table structure.
3. **Reconcile**: Compare sources, preserve conflicts, and produce an audit trail.
4. **Model**: Build linked calculations, assumptions, scenarios, checks, and documentation.
5. **Narrate**: Turn analysis into a decision story for a named audience and business moment.
6. **Render**: Create the workbook, slide deck, charts, visuals, and layout from the approved spec.
7. **Verify**: Check formulas, numbers, claims, layout, readability, contrast, and source match.
8. **Update**: Refresh last month's artifact without destroying structure, prior decisions, or the review trail.

The production bottleneck moved. File creation got easier. Judgment, verification, and workflow design got more valuable.

## Operating Rule

Use AI throughout Office work, but do not let it hide the truth layer.

Every claim should know where it came from. Every calculation should know what it depends on. Every assumption should be labeled as one. The finished file should have a review trail.

That is the difference between an AI-generated Office file that looks done and one you can actually trust.

Related upstream workflow: Nate's source-prep guide, [Use AI to organize your project files before you ask it to write](https://natesnewsletter.substack.com/p/ai-organize-files-before-writing).

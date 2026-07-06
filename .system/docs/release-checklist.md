# Release Checklist

Use this checklist before tagging or publishing a release checkpoint.

## Local Validation

```bash
npm --prefix .system run typecheck
npm --prefix .system test
git diff --check
```

Run the README quickstarts in a temp copy, not directly in the repo, so tracked examples and gitignored `deliverables/` stay clean:

```bash
tmpdir=$(mktemp -d /tmp/evidence-map-quickstart-XXXXXX)
mkdir -p "$tmpdir/input/examples"
cp -R .system "$tmpdir/.system"
rm -rf "$tmpdir/.system/node_modules"
ln -s "$PWD/.system/node_modules" "$tmpdir/.system/node_modules"
cp -R input/examples/capstone-report "$tmpdir/input/examples/capstone-report"
npm --prefix "$tmpdir/.system" run run -- --base-dir "$tmpdir" --name "capstone-report" --kind document --input input/examples/capstone-report
```

```bash
tmpdir=$(mktemp -d /tmp/evidence-map-legal-quickstart-XXXXXX)
mkdir -p "$tmpdir/input/examples"
cp -R .system "$tmpdir/.system"
rm -rf "$tmpdir/.system/node_modules"
ln -s "$PWD/.system/node_modules" "$tmpdir/.system/node_modules"
cp -R input/examples/legal-duty "$tmpdir/input/examples/legal-duty"
npm --prefix "$tmpdir/.system" run run -- --base-dir "$tmpdir" --name "legal-duty" --kind document --profile legal --input input/examples/legal-duty
```

## Artifact Checks

For the general quickstart, confirm:

- `03_verification/verification-report.md` exists.
- `03_verification/trust-report.json` reports `readiness: "blocked"`.
- `04_export/README.md` reports a refused general export gate.
- `04_export/general-export-refusal.md` explains unresolved blockers.
- The planted workbook, source-date, conflict, and seeded-claim findings remain visible.

For the legal quickstart, confirm:

- `01_source-packet/legal-source-packet.json` exists.
- `01_source-packet/legal-passages.json` contains paragraph anchors.
- `02_artifact-spec/legal-boundary.json` exists.
- `03_verification/legal-evidence-map.json` exists.
- `03_verification/legal-reuse-library.json` exists.
- `04_export/README.md` states whether final export is ready or refused.

## Boundaries

- Do not commit generated `deliverables/`.
- Do not add external legal research, model calls, filing, sending, or production database writes.
- Treat legal artifacts as reliability artifacts, not legal advice.

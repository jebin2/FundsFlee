# Phase-2 Parity Harness

Proves the Python sheets layer (`backend/app/sheets/`) behaves identically to
the TS one (`src/lib/sheets/`). Two checks:

## 1. Serialization parity (offline, no credentials)

Runs shared fixtures (`fixtures.json`) through both implementations of
`transactionToRow` / `rowToTransaction` / `isDeletedRow` /
`transactionUpdateToCells` and diffs the JSON.

```bash
npx vitest run parity/serialization.spec.ts        # writes ts-output.json
cd backend && python scripts/parity_serialization.py  # writes py-output.json + diffs
```

Either side also auto-compares against the other's output when it exists, so
running `npm test` after the Python script cross-checks again.

## 2. Live read parity (needs one backend sign-in)

Reads the real spending sheet through BOTH data layers and diffs
transactions, categories, and meta keys.

```bash
cd backend
python scripts/parity_live.py                  # writes py-live.json
eval $(python scripts/parity_live.py --print-token)
cd .. && npx vitest run parity/live.spec.ts    # writes ts-live.json
cd backend && python scripts/parity_live.py    # diffs both
```

Outputs (`*-output.json`, `*-live.json`) are gitignored — only
`fixtures.json` and the specs are tracked.

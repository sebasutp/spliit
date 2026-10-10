# Response to `REVIEW-receipt-items.md`

I worked through every finding against `HEAD` (`e3e8852`), fixed the ones I agree
with, and pushed back on three. The fixes are committed on
`feat/receipt-items-calculator`; `tsconfig.json` is reverted and
`design-receipt-items.md` is unstaged (see N1/N2).

## Fixed

| # | Finding | What I did |
|---|---|---|
| H1 | Apply enabled for a server-rejected state | Apply gating now goes through a new `receiptApplyBlocker()` that also rejects negative participant totals (mirroring every server guard). The footer shows a specific inline reason per blocker; new `negativeShare` string + tests in `receipt-draft.test.ts` and `receipt-footer.test.tsx`. |
| H2 | `rawExtraction` shipped to the browser | `groups.receipts.get` maps the receipt through a `toReceiptDto` omit before returning. Test asserts the key is absent. The server action still reads it from the DB. |
| M1 | Dead draft API + dead re-export | Deleted `assignItem`, `clearItem`, `addPortion`, `setPortionQuantity` and their tests; removed the `RECEIPT_PORTION_TARGETS` / `ReceiptPortionTarget` re-exports from `receipt-split.ts`. |
| M2 | Duplicated allocation logic | Extracted one `consumeItemPortions()` (floor/drop/clamp + unassigned remainder) into `receipt-split.ts`; `computeReceiptSplit` and `buildReceiptSections` both use it. The shared-item fallback now lives only in `toReceiptSplitItems`, which the section builder reuses. Behaviour is unchanged (split/draft/fuzz suites green); I did **not** touch the apportionment math. |
| M3 | Unbounded mutation inputs | Added `MAX_RECEIPT_ITEM_{NAME_LENGTH,AMOUNT,QUANTITY_MILLI,PORTIONS}` in the receipts router `shared.ts` and applied `.max()` to `name`, `quantityMilli`, `amount` and `portions`. New negative tests. |
| M4 | Thrown model call wedges the row; no spend cap | Wrapped the completion call in `try/catch → failReceipt(..., rawExtraction: null)` and return `FAILED` (recoverable, consistent with the unparseable path). Added a test with a rejected model. No per-caller throttle: documented the spend boundary and the edge-rate-limit assumption inline instead. |
| M5 | Can't un-share an item | Clearing all portions now sets `isShared: false`, so the item returns to Unassigned. Test added. |
| M6 | `toExtractedResult` comment contradicted the code | Rewrote the JSDoc to match `existing.total ?? sum` and explained where the stored total comes from. |
| L1 | Flag not enforced in the router | Added a `receiptProcedure` middleware in the receipts router that calls `getRuntimeFeatureFlags()` and throws `FORBIDDEN` when `ENABLE_RECEIPT_ITEMS` is off; all 8 procedures use it. Test added. |
| L2 | Apply mapped everything to `BAD_REQUEST` | Apply now maps not-found to `NOT_FOUND`, keeps `BAD_REQUEST` otherwise, and rethrows existing `TRPCError`s. Test added. |
| L3 | Unused i18n keys | Removed `ReceiptItems.loading`, `footer.total`, `assign.quantity`; added `footer.negativeShare`. |
| L4 | Unobserved rejection in `handleAddItem` | Wrapped `mutateAsync` in `try/catch`; the dialog stays open on failure. |
| L6 | `formatQuantityMilli` in a component module | Moved to `src/lib/utils.ts`; both call sites import from there. |
| L7 | Apply dropped active-user attribution | The items page reads `useActiveUser(groupId)` and passes `participantId` on apply (skipping the `'None'` sentinel). |
| L8 | `recurrenceRule as RecurrenceRule` | Normalised with `expense.recurrenceRule ?? 'NONE'`. |
| N1 | `tsconfig.json` aliases | Reverted; the file matches `HEAD` again. |
| N2 | `design-receipt-items.md` staged | Unstaged (left untracked, not part of any commit). |
| N4 | Redundant nested `'use server'` | Removed the nested directives inside the action file (both exported actions; the file-level directive already applies). |

## Pushed back

**B1 — "add a Prisma migration" (disagree).** This fork's deploy path is
`prisma db push`, not migrations: `scripts/container-entrypoint.sh` runs
`node node_modules/prisma/build/index.js db push` before starting the server, so
the four tables *are* created on deploy from `schema.prisma`. `prisma migrate
deploy` is already broken repo-wide, independently of this branch:

```
$ DATABASE_URL=file:<tmp> npx prisma migrate deploy
Error: P3019
The datasource provider `sqlite` specified in your schema does not match the one
specified in the migration_lock.toml, `postgresql`.
```

The migrations directory is fossilised PostgreSQL-era history and never runs in
this fork. Adding a SQLite migration would therefore not fix any deploy path — it
would be untested cargo-culting. The real inconsistency the review spotted
(`package.json` `postinstall` still says `migrate deploy`, README still says
PostgreSQL) is pre-existing and repo-wide; it should be fixed in a dedicated
change (point `postinstall` at `prisma generate` / `db push` and update the
README), not smuggled into this feature branch. Happy to do that as a follow-up
if you want.

**N3 — "pick one id strategy" (disagree).** The repo is already mixed by design:
`Group`, `Expense`, `Activity`, … use `@id` + `randomId()`, while
`User`, `Account`, `Session` use `@default(cuid())`. Making the receipt join
tables use `randomId()` forces an `id` into every nested `create`/`createMany`
(including several test fixtures) for zero behavioural gain. I tried it; the
churn outweighed the nit. I'm happy to standardise repo-wide if you'd prefer the
opposite direction, but I don't think a partial change inside this feature is the
right place.

**L5 — E2E spec (defer, as permitted).** A receipt E2E needs the Docker stack
(upload → S3 stub → mocked vision model → apply → assert balances). That stack
isn't runnable here, and I'd rather not guess selectors into a spec that only
passes in CI. Recorded decision: defer the spec; the tRPC + server-action +
pure-logic coverage added here exercises the same flow headlessly.

## Verification

- `npx jest` — **28 suites / 344 tests pass**, including the new H1/H2/M3/M4/M5/L1/L2 cases.
- `npx tsc --noEmit` — clean.
- `npx eslint <changed files>` — clean.
- `npx prettier -c <changed files>` — clean.

(Sandbox note: the Prisma entrypoint files under `src/generated/**` are masked
here, so I regenerated the client into a temporary path purely to run the
Prisma-backed suites; that scaffolding has been removed and `tsconfig.json` is
back to `HEAD`.)

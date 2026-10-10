# Implementation Plan — Receipt Line Items as an Optional Calculator

Status: Human approved

The human asked also for:
* TDD: There should be unit tests for all implemented features
* The tests should mock the AI call, never actually call it
* The tests should include fractions like 1/3 and make sure that nothing is left unassigned if there are 3 people
* When the helper UI shows the totals to be assigned per user, it should also show the current assignment, and allow
  the user to do manual corrections if necessary.

## 1. Guiding principles (condensed)

1. **The expense is ground truth.** Balances/stats/exports read only `Expense.amount` + `ExpensePaidFor`; nothing on the receipt side writes to an expense implicitly.
2. **The items screen is an optional helper.** It shows the breakdown, does the arithmetic, and computes *provisional* per-person totals.
3. **Lowest friction by default.** Upload → total extracted → expense prefilled with that total split `EVENLY`. Item assignment is opt-in.
4. **Assignment is a quantity split, not a binary tag.** Any fractional quantity of an item goes to any participant or to `SHARED`; one model covers 0.5/0.5 dishes, "2 of the 3 beers", and repeated items.
5. **Explicit transfer.** Items-screen edits produce provisional totals; they reach the expense only on **Apply to expense**.

## 2. Mental model & default state

Upload → total extracted → expense = total, split equally. Items exist as a breakdown where **normal items are `UNASSIGNED`** and **whole-bill charges (tax/tip/service/cover) are `SHARED`**. Net cost equals an equal split until someone changes something.

- **Portion**: a `(target, quantityMilli)` allocation of an item's quantity; target ∈ {participant, `SHARED`}.
- **Unassigned portion**: derived remainder `item.quantity − Σ portions`; not stored.
- **Shared pool**: portion amounts targeted `SHARED`; split equally among **all** participants.
- **Unassigned pool**: derived unassigned amounts; split equally among participants who share unassigned (default: everyone).
- **Opt-out**: per-participant, per-receipt flag meaning "don't charge me the unassigned pool".

## 3. Split computation — `src/lib/receipt-split.ts` (new, pure, unit-tested)

All money in minor units; quantities in **thousandths** (integers) for exact arithmetic (`0.5→500`, `2→2000`, `1/3→333`).

```
input: participants P, optedOut ⊆ P, items[{ amount A_i, quantityMilli Q_i, portions[(target,qty)] }]

0. sanitize: Q_i = max(Q_i,1); drop portion qty beyond Q_i; clamp qty ≥ 0
1. per item i: parts = portions + [UNASSIGNED with qty = Q_i − Σ portion.qty]
   amounts_i = weightedApportion(A_i, weights = [part.qty…])   # largest remainder, Σ == A_i
   credit each to direct[p] / sharedPool / unassignedPool
2. sharedShare[p]     = distributeAmount(sharedPool, |P|)               # everyone
   sharers            = P \ optedOut
   unassignedShare[p] = p ∈ optedOut ? 0 : distributeAmount(unassignedPool, |sharers|)
3. provisional[p] = direct[p] + sharedShare[p] + unassignedShare[p]
   invariant: Σ provisional[p] == Σ A_i == itemsTotal
```

- Reuse `apportion()` / `distributeAmount()` in **`src/lib/shares.ts`**. `apportion` is currently **private** and already accepts arbitrary integer weights; expose it (export it or add a thin `weightedApportion(amount, weights)` wrapper). The largest-remainder / "no lost cents" guarantee carries over.
- **Shared ≠ unassigned, deliberately:** shared is an explicit whole-bill cost (everyone pays, even opt-outs); unassigned is residual (only sharers pay).
- **All-opted-out guard:** if `sharers` is empty while `unassignedPool ≠ 0`, block Apply with an inline explanation.
- **Reconciliation:** if `Σ items ≠ printed total`, synthesize an **"Adjustment"** item (default `isShared`) and surface the delta; never silently drop it.

## 4. Apply semantics (ground truth preserved)

`Apply to expense` builds a `BY_AMOUNT` update: `amount = itemsTotal`, `paidFor = [{ participant: p, shares: provisional[p] } for provisional[p] > 0]`. Because apportionment guarantees `Σ shares === amount`, existing schema validation passes. Reuse `createExpense` / `updateExpense` in `src/lib/api.ts` — **no new balance path**. If the user changed the amount so it differs from `itemsTotal`, confirm "total 42.50 → 47.70" and apply the provisional amounts (default). Divergence after a later manual edit is allowed: show a "receipt values differ" note + "Apply again"; never auto-correct.

## 5. Data model (additions)

The four new models (summarized; see schema/migration for exact fields):

- **`Receipt`** — one persisted parse per image per group (`@@unique([groupId, imageUrl])`); anchors ground truth via `expenseId?` (`onDelete: SetNull`). Key fields: `imageUrl`, `imageWidth/Height`, `status` (`PENDING|EXTRACTED|FAILED`), `rawExtraction?`, `provider`, `model`, `merchant`, `receiptDate`, `currencyCode`, `total?`.
- **`ReceiptItem`** — a line: `name`, `quantityMilli` (default 1000), `unitPrice?`, `amount` (line total), `isShared` (tax/tip/service/cover), `isAdjustment`, `position`; has many `portions`.
- **`ReceiptItemPortion`** — `(target: PARTICIPANT|SHARED, participantId?, quantityMilli)`; encodes the fractional assignment. Unassigned is derived, so removing a portion returns its quantity to the pool.
- **`ReceiptOptOut`** — join row `(receiptId, participantId)`; absence = shares unassigned (default), so no rows exist until someone opts out.

Relations added: `Group.receipts`, `Participant.receiptPortions` / `receiptOptOuts`, `Expense.receipt?`. Requires a new Prisma migration.

Persistence policy (**AI once**): on upload, look up `Receipt` by `(groupId, imageUrl)` — reuse parsed items if found; else create `PENDING`, call the model once, store `rawExtraction` + items, set `EXTRACTED`. Assignments/opt-outs persist debounced as edits happen (cheap helper rows; never touch the expense).

## 6. Extraction update

The response grows from a total to items + charges (still `strict: true`, still validated defensively): `items[] {name, quantity, unitPrice, amount}` → `ReceiptItem{isShared:false}` with **no portions (unassigned)**; `charges[] {name, amount, shared:true}` → `ReceiptItem{isShared:true}` (**shared pool**); plus `merchant/date/currencyCode/total/categoryId`. Prompt rule: only tax/tip/service/cover/delivery are shared; never guess a normal item is shared. Leftover `Σ lines − total` → adjustment item. Keep the total-only action for the plain path. New env `OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT` (defaults to `OPENAI_MODEL_RECEIPT_EXTRACT`). One AI call per `(groupId, imageUrl)`.

## 7. Items screen (UX)

Fixed group order: **Unassigned → Shared → per participant**; footer shows provisional totals, a reconciliation badge, and **Apply to expense**.

- A portion appears in its target's list; a 0.5/0.5 split shows in both user lists, remainder in Unassigned.
- **Assign/Split** an unassigned item to a user, `Shared`, or fractional quantities per user; **Move** or **remove** a portion to return quantity to Unassigned.
- **Opt-out checkbox** per participant (default on) — the "cheaper dish" escape hatch.
- **Edit** amount/quantity/name; **add/delete** items; totals update live.
- Degenerate states: no items → single "Split equally (N ways)"; all unassigned/all sharing → "matches equal split"; all opted out with a non-empty unassigned pool → block Apply.
- Mobile full-page route, collapsible sections, sticky footer; desktop two-column if space allows.

## 8. Feature flags / config

```env
ENABLE_RECEIPT_ITEMS=true              # runtime, opt-in, default off
NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS=true
OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT=<vision model>
```

Implies `ENABLE_RECEIPT_EXTRACT` and requires `OPENAI_API_KEY` (extend the `superRefine` check in `src/lib/env.ts`); still needs S3/documents for image hosting. The plain total-only path stays available when the flag is off. Flags live in `src/lib/featureFlags.ts` (live `process.env` for `ENABLE_*`).

## 9. Testing

- **`receipt-split.ts` (highest value):** equal imprint; 0.5/0.5; 2-of-3; repeated item; opt-out (own portion only, still pays shared tax); remove portion returns to unassigned; randomized `Σ provisional === itemsTotal`; all-opted-out guard.
- **Extraction** (mirrors `create-from-receipt-button-actions.test.ts`): mocked `openai`, strict schema asserted, malformed → FAILED, charges shared / items unassigned.
- **tRPC/API:** Apply yields `BY_AMOUNT` shares summing to amount and matching provisional totals; a later edit doesn't re-apply.
- **E2E:** upload a fixture, save equal split, open items, split/assign/opt-out, Apply, assert balances.

## 10. Security, privacy, cost

- Server-side flag enforcement; `isAllowedUploadUrl` SSRF guard; one AI call per `(groupId, imageUrl)`; rate-limit the server action to cap spend.
- Server recomputes provisional amounts from stored items — never trusts client-sent totals.
- `rawExtraction` retention is optional (privacy/storage trade-off); item parsing costs more tokens on long receipts than total-only extraction.

## 11. Stages

| Phase | Ships | Key files | Done when | Est. |
| --- | --- | --- | --- | --- |
| **P0** | Schema + migration; pure split module | `prisma/schema.prisma` + migration; `src/lib/receipt-split.ts`; expose `apportion`/`weightedApportion` in `src/lib/shares.ts` | Unit tests green, including the `Σ provisional === itemsTotal` invariant | 1.5–2.5 d |
| **P1** | v2 extraction (items + charges + adjustment), persistence, "called once", provider fallback, flag | `create-from-receipt-button-actions.ts` (+ test); `src/lib/env.ts`; `src/lib/featureFlags.ts`; receipt persistence in `src/lib/api.ts` + new `src/trpc/routers/groups/receipts/*` | With flag on: one call per `(groupId, imageUrl)`, items stored, re-upload reuses the parse | 2–3 d |
| **P2** | Items screen: 3 sections, fractional split, opt-out, live provisional totals | New route `src/app/groups/[groupId]/expenses/[expenseId]/items/…`; UI components | Any receipt can be fully itemized and totals reconcile live | 3–4 d |
| **P3** | Apply-to-expense + expense-page entry point + linking + E2E | Apply via `updateExpense`; `edit-expense-form.tsx` / `page.client.tsx`; `create-from-receipt-button.tsx` (prefill + link) | Apply produces a `BY_AMOUNT` expense matching provisional totals; balances correct | 1.5–2.5 d |
| **P4** | Polish: reconciliation UX, long receipts, add/delete items, docs, i18n | UX + `messages/en-US.json`, `README.md`, `src/lib/analytics/events.ts`, `e2e/` | Polish items shipped and reviewed | 2–3 d |

**v1 (P0–P3): ~8–12 dev-days; with polish ~9–14.** Cheapest de-risk: land P0+P1 behind the flag, then a throwaway read-only page rendering parsed items + provisional totals on real receipts to validate extraction quality before building the interaction.

## 12. Assumptions to confirm (8 open decisions resolved)

1. **Provider:** a vision-capable OpenAI-compatible endpoint (Gemini) is available; text-only hosted APIs can't do items extraction (total-only still can).
2. **Apply vs amount conflict:** default to updating the total to `itemsTotal`; scaling onto the existing total is a later addition.
3. **Opt-out scope:** opting out excludes only the unassigned pool; `SHARED` charges (tax/tip) always apply to everyone.
4. **Assignment persistence:** persist debounced per edit (survives refresh), accepting mild multi-editor risk.
5. **Divergence UX:** keep stale receipt items with a "receipt values differ · Apply again" hint; never lock or auto-correct.
6. **Adjustment line:** defaults to `SHARED`; the user can move it.
7. **`rawExtraction`:** retained by default (enables re-parse after schema changes); can be dropped for stricter privacy.
8. **`SHARED` is whole-bill only:** v1 shared = everyone; per-subset sharing is a v2 idea.

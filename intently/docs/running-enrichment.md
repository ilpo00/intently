# Running vision enrichment (and resetting the demo)

Operator guide. Covers how to enrich the catalogue **on the cloud demo** and how to
put the Studio back to a clean state so a demo can be run from the beginning.

> **What changed (2026-07-18).** Enrichment used to shell out to
> `scripts/vision-enrich.mjs`, which meant it could only run on a laptop —
> serverless has no child-process model and a read-only filesystem, so the
> button returned a 500 on the cloud demo. The batch now runs **in-process, in
> resumable chunks**, and its output goes to Supabase on cloud / local JSON
> files on a laptop. Same code path both places. The CLI script is retired
> (recoverable from git history); the Studio button is the only way in.

---

## 1. Running enrichment

Go to **Studio → Catalogue** (full catalogue) or **Studio → Vision** (the
10-product teaching sample) and press **Run vision enrichment**.

| Scope | Where | Products | Time | Est. cost |
|---|---|---|---|---|
| Sample | Studio → Vision | 10 | ~20 s | ~$0.02 |
| Catalogue | Studio → Catalogue | 292 | **~15 min** | ~$0.55 |

**Why the catalogue takes 15 minutes.** The Anthropic org rate limit (50
req/min, and 10k output tokens/min against a reserved `max_tokens` of 420)
allows roughly one product every 2.6 seconds. That is the floor; it is not
something the app can optimise away.

### What you'll see

A progress bar with `n/292 products`, the running cost so far, and a rough ETA.
Press **show log** for the per-product tail (colour, pattern, and any Tier-0
validator corrections).

### Keep the tab open

The browser drives the loop — it asks the server for one chunk at a time,
because a single serverless request is capped at 60 seconds. So:

- **Closing the tab pauses the run.** It does not lose it.
- Re-open the page and the button reads **Resume (137/292)**. Continue where it
  stopped.
- **Already-enriched products are never re-analysed or re-charged.** Resume
  starts from the cursor; only an explicit reset re-runs everything.
- A product whose image fails is recorded as failed and skipped — one bad file
  can't kill a 15-minute batch.

### Prerequisites on cloud

Already configured on the current deployment; listed for when it is rebuilt:

- `ANTHROPIC_API_KEY` in the Vercel environment (the vision model).
- `INTENTLY_STORE=supabase` plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  (output has nowhere else to go — the filesystem is read-only).
- Migration `0016_vision_records.sql` applied.
- Product photos ship in `public/catalog/` and are pulled into the function
  bundle by `outputFileTracingIncludes` in `next.config.js`. **Don't remove
  that** — without it the image read succeeds locally and `ENOENT`s in
  production, which is the worst kind of difference.

---

## 2. Resetting for a fresh demo

**Studio → Configuration → Reset the demo.** Tick what to clear, type `RESET`,
confirm. Nothing is preselected and nothing happens without the typed
confirmation.

| Tier | Clears | Cost to undo |
|---|---|---|
| **PM tuning** | Situations, model configuration, curated attributes, needs-attention queue | Cheap — re-tune |
| **Vision enrichment output** | Every attribute read from a photo | **Re-run the batch: ~15 min + real spend** |
| **Analytics history** | Turns, cart adds, orders — funnel and token spend | **Unrecoverable** |

### The full "beginning to end" demo loop

1. Reset **PM tuning + Vision enrichment output** (leave analytics unless you
   want a clean funnel too).
2. Studio → Catalogue now reads *no vision-enriched catalogue yet* — the
   honest "before" state.
3. Press **Run vision enrichment**. Narrate the pipeline while it fills in.
4. Show Catalogue readiness climbing, then Situations, then live Discovery.

For a **short** demo, reset only the sample scope by running the Vision page's
enrichment — 20 seconds start to finish, and it makes the same point.

> **Plan the catalogue reset.** Clearing enrichment before a live audience
> means 15 minutes of dead air. Do it beforehand, or demo the sample scope.

---

## 3. What is *not* regenerated

Clearing the vision output clears the **enrichment records** the Studio's
Vision and Catalogue pages read. It does **not** rebuild:

- `src/lib/catalog/vision-catalog.json` — the committed product catalogue
  discovery ranks over.
- The **vector index** the semantic search uses.

Those are still build-time artifacts. So a cloud re-run repopulates the
*enrichment surfaces* but does not by itself change what the shopper-facing
discovery returns. Closing that loop needs the vector store on Supabase
pgvector plus a re-index — tracked as step #4 in
[cloud-demo-plan.md](cloud-demo-plan.md).

**Locally** the loop is complete: run enrichment → `.enrichment/vision-catalog.json`
→ `node scripts/build-vision-catalog.mjs` → commit → the catalogue discovery
uses is updated.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ANTHROPIC_API_KEY is not set` (400) | Key missing from the environment | Add it to Vercel env / `.env.local`, redeploy or restart |
| `could not persist vision records to Supabase` | `INTENTLY_STORE`/keys unset, or `0016` not applied | Check env, apply the migration |
| Progress stalls, log shows `✗ … ENOENT` | Images not in the function bundle | Confirm `outputFileTracingIncludes` in `next.config.js` |
| Run says *paused* and won't resume | Browser tab was closed | Press **Resume** — the cursor is server-side |
| Rate-limit errors in the log | Another run in parallel | Run one at a time; the SDK already retries |

## Related

- [cloud-demo-plan.md](cloud-demo-plan.md) — cloud demo scope and remaining steps
- `wiki/concepts/cloud-demo-deployment.md` — why the serverless constraints exist
- `wiki/concepts/vision-enrichment.md` — what the batch extracts and what it costs

# Intently PIM · Medusa v2

This directory hosts a Medusa v2 backend used as the PIM (Product Information
Management) layer for Intently's enrichment pipeline. It seeds with 10 fashion
products drawn from the Kaggle Fashion Product Images dataset, mirroring the
curated set in `intently/src/lib/enrichment/pim-kaggle-curated.ts`.

The Medusa instance is the **source of truth for product master data**. The
enrichment layer in `intently/` reads from this Medusa via its Store REST API,
embeds each product, and persists the vectors locally (today) or in Supabase
pgvector (when ready).

## Prerequisites

- **Node.js 20+** (`node --version`)
- **PostgreSQL 14+** (running locally on port 5432)
- **Redis** (optional in dev; required for events/jobs in prod)

On macOS the fast path is:

```bash
brew install node postgresql@16 redis
brew services start postgresql@16
brew services start redis        # optional
```

Verify Postgres is reachable:

```bash
psql -h localhost -U $USER -d postgres -c '\l'
```

## One-shot setup

```bash
cd pim
./setup.sh
```

`setup.sh` will:

1. Verify Node and Postgres are present.
2. Create the `intently_pim` database (idempotent — re-runs are safe).
3. `npm install` the Medusa starter.
4. Run Medusa's own migrations (`npx medusa db:migrate`).
5. Run the Kaggle seed script (creates the 10 products + admin user + sales
   channel + default region).
6. Print the admin login link.

After it finishes, start Medusa:

```bash
npm run dev
```

Medusa listens on port `9000` by default:

- Admin UI: <http://localhost:9000/app>
- Store API: `http://localhost:9000/store/*`

Default admin login (configurable in `.env`):

```
email:    admin@intently.local
password: supersecret
```

> Change these in `.env` before going anywhere near production.

## Wiring the enrichment layer to Medusa

By default the enrichment layer in `intently/` reads from the curated Kaggle CSV
in-process (zero-infra mode). To switch it to read from this Medusa instance:

In `intently/.env.local`:

```
PIM_SOURCE=medusa
MEDUSA_BACKEND_URL=http://localhost:9000
MEDUSA_PUBLISHABLE_KEY=pk_...        # copy from Medusa admin → Settings → Publishable Keys
```

Then in the `/admin/enrichment` page in Intently, click **Sync from PIM**.
The pipeline will fetch every product from Medusa, build the embed text, run
it through the embedder, and upsert into the vector store.

## File map

```
pim/
├── README.md                       (this file)
├── setup.sh                        one-shot setup (postgres + npm + migrations + seed)
├── package.json                    Medusa v2 deps
├── tsconfig.json
├── medusa-config.ts                Medusa runtime config
├── .env.template                   copy to .env
├── .gitignore
└── src/
    └── scripts/
        └── seed-kaggle.ts          loads the 10 curated Kaggle products
```

## Why a separate Medusa instance instead of folding into Next.js?

- Clean PIM/storefront separation. The Next.js app shouldn't host product
  authoring — that's Medusa's job.
- Lets us swap the PIM later (Shopify, Akeneo, etc.) without touching the
  enrichment layer. The `PimAdapter` interface is the contract.
- Medusa's admin UI is a real product-editing surface for free.

## Troubleshooting

- **`role "$USER" does not exist`** — your local Postgres needs your user as a
  role. Run `createuser -s $USER` first.
- **`database "intently_pim" already exists`** — fine, the setup script is
  idempotent.
- **`npx medusa: command not found` during seed** — `npm install` failed; re-run
  it manually and look for missing peer deps.
- **Port 9000 already in use** — set `PORT=9001` in `.env` and update
  `MEDUSA_BACKEND_URL` in `intently/.env.local` to match.

## Re-seeding

The seed script is idempotent at the product level (uses handles like
`kaggle-15970`). Re-running adds nothing new. To start fresh:

```bash
dropdb intently_pim && createdb intently_pim
npx medusa db:migrate
npm run seed
```

# ─────────────────────────────────────────────────────────────────
# Intently PIM · Medusa v2 container
#
# node:20 (not the host's node 24 — Medusa 2.4.0 targets Node 20) on
# Debian slim. Native deps (sharp, argon2, etc.) build cleanly with
# python3/make/g++; postgresql-client gives the entrypoint pg_isready.
# ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

WORKDIR /server

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates curl postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# Install deps first for layer caching. pim/ has no lockfile, so npm install.
# --foreground-scripts streams native build output (e.g. isolated-vm's C++
# compile) so a slow step is visible rather than a silent stall.
COPY package.json ./
RUN npm install --no-audit --no-fund --foreground-scripts

# App source (node_modules / .medusa excluded via .dockerignore).
COPY . .

RUN chmod +x ./start.sh

EXPOSE 9000

CMD ["./start.sh"]

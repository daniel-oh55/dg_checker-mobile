# DG Segregation Mobile

A mobile app for reviewing IMDG dangerous goods segregation, built independently from any internal/company system.

## Prerequisites

- Node.js 20+
- pnpm

## Install

```bash
pnpm install
```

## Mobile (Expo)

```bash
pnpm --filter mobile start
```

By default the app talks to the production Worker at
`https://dg-segregation-api.baseballmeng.workers.dev`. For local development
against a Worker running elsewhere, override with:

```bash
EXPO_PUBLIC_API_BASE_URL=http://<your-dev-host>:8787 pnpm --filter mobile start
```

## Android release builds (EAS)

Android application ID: `com.hymlounge.segregationchecker` (final).
Build profiles live in [mobile/eas.json](mobile/eas.json).

One-time setup — requires the project owner's Expo account:

```bash
npm install -g eas-cli
eas login
cd mobile && eas init      # links the project and writes extra.eas.projectId
```

Builds (run from `mobile/`):

```bash
eas build --platform android --profile preview      # installable APK for device QA
eas build --platform android --profile production   # AAB for Google Play
```

`versionCode` is read from `mobile/app.json` (`cli.appVersionSource: "local"`),
so bump it there for each Play upload.

## Worker (Cloudflare)

```bash
pnpm --filter worker dev
```

## D1 local migration

```bash
pnpm --filter worker run migrate:local
```

## Production backend (Cloudflare)

```bash
# apply committed migrations to the remote D1 database
pnpm --filter worker exec wrangler d1 migrations apply dg-segregation-db --remote

# deploy the Worker
pnpm --filter worker exec wrangler deploy
```

Production health check: `https://dg-segregation-api.<account>.workers.dev/health`

## Check

```bash
pnpm check
```

The project currently contains no production IMDG dataset.

## Private dataset import (local only)

The production/authorized IMDG dataset is never committed to this repository.
`worker/private-data/` and `worker/generated-data/` are gitignored — place an
authorized dataset snapshot there for local use only.

```bash
# validate a private dataset snapshot
pnpm --filter worker dataset:validate -- private-data/dataset.json

# generate deterministic SQL from a validated snapshot
pnpm --filter worker dataset:build -- private-data/dataset.json generated-data/dataset.sql

# load the generated SQL into your local D1 database
pnpm exec wrangler d1 execute DB --local --file=worker/generated-data/dataset.sql
```

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

## Worker (Cloudflare)

```bash
pnpm --filter worker dev
```

## D1 local migration

```bash
pnpm --filter worker run migrate:local
```

## Check

```bash
pnpm check
```

The project currently contains no production IMDG dataset.

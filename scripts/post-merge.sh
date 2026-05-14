#!/bin/bash
set -e
pnpm install --frozen-lockfile
psql "$DATABASE_URL" -f scripts/migration.sql

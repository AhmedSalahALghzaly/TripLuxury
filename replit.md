# Al-Ghazaly Dining AI

A full-stack AI-powered dining app with an Expo mobile frontend and Express API backend. Users can browse restaurants, place orders, chat with an AI assistant, and manage their dining experience.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/mobile run dev` — run the Expo mobile app (port 18115)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `psql "$DATABASE_URL" -f scripts/migration.sql` — run DB migrations

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, esbuild (ESM bundle), pino logging
- DB: PostgreSQL (direct `pg` Pool via `server-db.ts`, NOT Drizzle ORM for main routes)
- Mobile: Expo SDK 54, Expo Router v6, React Native 0.81
- State: Zustand with AsyncStorage persistence
- AI: OpenAI via Replit AI Integration proxy
- Analytics: PostHog (server + client)
- Monitoring: Sentry (optional, gated on SENTRY_DSN env var)
- Auth: Email/password + Google OAuth + Replit Auth headers

## Where things live

- `artifacts/api-server/src/server-routes.ts` — **all** API routes (178 endpoints, ~9000 lines)
- `artifacts/api-server/src/server-db.ts` — pg Pool connection
- `artifacts/api-server/src/server-auth.ts` — auth helpers (requireAuth middleware)
- `artifacts/api-server/src/routes/` — sub-routers: ai.ts, chat.ts, appointments.ts, knowledge-base.ts, restaurant-analytics.ts
- `artifacts/mobile/app/` — Expo Router screens
- `artifacts/mobile/src/services/api.ts` — Axios client (baseURL from EXPO_PUBLIC_DOMAIN)
- `artifacts/mobile/src/store/appStore.ts` — Zustand global store
- `scripts/migration.sql` — full DB schema (already applied)

## Architecture decisions

- API routes are registered directly on the Express app (not via sub-routers) inside `registerRoutes()` in `server-routes.ts`
- Mobile API base URL is `https://${EXPO_PUBLIC_DOMAIN}/api` — routes through the Replit reverse proxy
- `@opentelemetry/*` packages are marked external in esbuild and must be installed as runtime deps (Sentry requires them)
- `expo-secure-store` plugin removed from `app.json` plugins (causes Expo Go startup error); the package still works via its JS API
- WebSocket server runs on the same HTTP server instance as Express

## Product

- Browse restaurants, menus, and products by category
- Add to cart, checkout, track orders
- AI chat assistant powered by OpenAI
- Owner/admin dashboard with analytics, order management, low-stock alerts
- Restaurant manager role with scoped restaurant access
- Push notifications (Expo) for order updates
- Offline support via local SQLite cache
- Google OAuth + email/password + Replit Auth

## Required Environment Variables

- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` — auto-injected by Replit
- `SESSION_SECRET` — session signing key
- `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` — set via Replit OpenAI integration
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` + `PUBLIC_OBJECT_SEARCH_PATHS` + `PRIVATE_OBJECT_DIR` — set via Replit Object Storage
- `GOOGLE_CLIENT_SECRET` — Google OAuth server secret
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth client ID (mobile)
- `EXPO_PUBLIC_POSTHOG_KEY` + `EXPO_PUBLIC_POSTHOG_HOST` — PostHog analytics
- `SENTRY_DSN` — optional; Sentry monitoring disabled if not set
- `EXPO_PUBLIC_SENTRY_DSN` — optional; mobile Sentry monitoring

## Gotchas

- **Never call service ports directly** — always go through `localhost:80` (the shared Replit proxy)
- `server-routes.ts` is the source of truth for all routes; `app.ts` only sets up middleware
- The DB schema lives in `scripts/migration.sql` — run it to set up a fresh database
- OpenTelemetry packages must all be installed as runtime deps in `@workspace/api-server` (not just root)
- The mobile `owner-placeholder` tab screen file must exist even though it's hidden (`href: null`)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Seed Data

- `scripts/seed-aswan.sql` — Aswan-themed seed: 6 cuisines, 6 luxury restaurants (1902, Nubian House, Sunset Felucca, Movenpick, Al Masry, Makka), 8 categories, 4 combo meals, 15 dishes (foul, falafel, koshari, molokhia, mixed kebab, grilled tilapia, om ali, etc.). Re-run with `psql "$DATABASE_URL" -f scripts/seed-aswan.sql` (idempotent — uses ON CONFLICT DO NOTHING).

## Owner Account

- Email: `Pc.2025.ai@gmail.com` / Password: `0135790` — promoted to admin (`is_admin=TRUE`) and added to `owners` table. The mobile app's `(tabs)/_layout.tsx` recognises this exact email as the owner via `OWNER_EMAIL` constant.

## Roadmap (from Dining-Ai_1778344420595.txt)

The attached spec contains ~30 feature enhancements across owner UI, customer UI, ratings, brand pages, Google Maps integration, real-time notifications, PDF/CSV export, etc.

### Done in the Pro Overhaul session
- Shared admin/PageConfigPanel + tabs moved (cuisines / detail / brands).
- Admin/models preview pane is toggleable on narrow screens.
- MapsPreviewStrip is web-aware (iframe on web, RN WebView on native).
- Add buttons disabled + spinner during PDF / video upload + GPS picking.
- Marketing footer video upload fixed (file size guard + handler).
- Owner notification-log: restaurant filter strip + ?restaurant_id URL scoping.
- Restaurant-analytics user-mgmt: scoped notification-log icon (?restaurant_id).
- Server: push-log endpoints accept restaurant_id; orders accept and persist
  delivery_latitude / delivery_longitude / delivery_address as first-class
  columns (migration already applied to live DB).
- Checkout: reverse-geocode autofills blank address fields after GPS pick;
  place-order CTA is gated on a confirmed location with a clear bilingual hint.
- RatingModal: inline error feedback on submit failure (no more silent dismiss).
- brand/[id]: combo-duplicate lockout modal with Replace / Cancel.

### Still on the roadmap
- Local notifications i18n + reliability hardening across the app shell.
- Ratings display surfaces (per-product, per-brand) beyond the existing
  restaurant-card badges.
- Smarter shared-element transitions on combo strip → /brand/:id.
- Owner export (PDF/CSV) parity for newer analytics views.

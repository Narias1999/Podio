@AGENTS.md

## Project overview

Podio is a web application for cycling and running race organizers. It handles the full lifecycle of a race: creating races and stages, registering riders, entering results, and publishing live standings to a public results page.

The app's core feature is real-time race timing. For time trials, it generates a start order (random for opening stages, inverse GC for mid-race stages) and provides two live views: a start line countdown screen that advances automatically as riders depart, and a finish line screen where an operator taps STOP to capture each rider's time and assigns it to a bib number. For road/group stages, the same two-screen model applies — the start line operator selects categories and taps Start, and the finish line operator captures groups of riders arriving together, assigns their bibs, and sets their within-group order.

All writes during live sessions are queued in local storage first and synced to the server asynchronously, with automatic retries every 60 seconds, because operators work in areas with poor connectivity. A persistent connectivity indicator warns operators when they have pending unsynced data.

Results are published to a public-facing results page in real time as they are saved. Multi-stage races include an automatically computed General Classification (GC) based on cumulative stage times.

**Tech stack:** Next.js, Supabase (database, auth, Realtime), Vercel  
**Primary users:** Race organizers (non-technical)  
**Secondary users:** Riders and spectators (public, unauthenticated)

## Implementation conventions (read before writing any code)

These apply to every story. The full specs live in `docs/race_tracker_stories/` — Story 01 is the authoritative schema/types/authorization source.

### Language
- The app is **Spanish-only (es-CO)**. Every user-facing string — labels, buttons, headings, validation/error messages, empty states, toasts, metadata — is written in Spanish. No i18n library; write the Spanish copy directly in the components.
- Code stays English: identifiers, file names, DB tables/columns, types, comments.
- Use es-CO locale for dates/times/numbers (`date-fns` is installed; format with the `es` locale). `<html lang="es">`.

### Authorization — no RLS (Story 01)
- RLS is **off**. All writes go through Next.js route handlers under `app/api/...`.
- A route handler: (1) authenticates via the Supabase server session (`lib/supabase/server.ts`), (2) verifies the session user owns the target race (`races.organizer_id = session.user.id`), (3) performs the write with a **service-role** server client. Add a `lib/supabase/admin.ts` helper that builds a service-role client from `SUPABASE_SERVICE_ROLE_KEY` (server-only — never imported into client components).
- Organizer reads happen in server components scoped to the session user. Public reads (results, start lists) happen in server components / public read endpoints that only return `published`/`completed` races (draft → 404).
- The live-tracking write queue (Story 15) flushes by POSTing to these endpoints — no privileged Supabase writes from the client.

### Stack specifics
- **Next.js 16** — this is not the Next.js in your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing routing/server code. Note: middleware lives in `proxy.ts` at the root (already present), not `middleware.ts`.
- **shadcn/ui** (style `radix-nova`) — reuse `components/ui/` primitives; add missing ones via `npx shadcn@latest add <component>` rather than hand-rolling. Composite components go in `components/`.
- Shared types in `types/database.ts` (generated) and `types/app.ts` (aliases).
- Run `npm run lint` and `npx tsc --noEmit` (or `npm run build`) before considering a story done.

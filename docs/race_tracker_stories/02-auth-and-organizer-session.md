# Story 02 — Auth & organizer session

## Overview
Set up authentication using Supabase Auth so that organizers can sign in and access their own races. Public viewers access results pages without logging in.

## User story
As a race organizer, I need to sign in to the app so that I can create and manage my races and only see my own data.

## Scope

### Sign in
- Email + password authentication via Supabase Auth
- Single sign-in page at `/login`
- No self-registration — organizer accounts are created manually in the Supabase dashboard for v1
- On successful login, redirect to `/dashboard`
- On failed login, show a plain-language error: "Incorrect email or password. Please try again."

### Session management
- Use Supabase's server-side session via `@supabase/ssr`
- Session is persisted across page refreshes
- Middleware protects all routes under `/dashboard` and `/races/[slug]/manage` — unauthenticated users are redirected to `/login`
- Public routes (`/races/[slug]/results`, `/races/[slug]/stages/[stage]/startlist`) are always accessible without a session

### Sign out
- A sign out button accessible from the dashboard navigation
- Clears the session and redirects to `/login`

### Organizer identity
- The authenticated user's `id` from `auth.users` is used as `organizer_id` on all races they create
- There is no RLS (Story 01). Authorization is enforced in Next.js route handlers: every write endpoint verifies the session user owns the target race (`races.organizer_id = session.user.id`) before mutating, and organizer reads are scoped to the session user's id — an organizer can never read or write another organizer's races

## Routes

| Route | Auth required |
|---|---|
| `/login` | No |
| `/dashboard` | Yes |
| `/races/[slug]/manage/*` | Yes (owner only) |
| `/races/[slug]/results` | No |
| `/races/[slug]/stages/[stage]/results` | No |
| `/races/[slug]/stages/[stage]/startlist` | No |
| `/races/[slug]/stages/[stage]/live/start` | Yes |
| `/races/[slug]/stages/[stage]/live/finish` | Yes |

## Middleware
Create `/middleware.ts` at the project root:
- Refresh the Supabase session on every request
- Redirect to `/login` if no session is present and the route is protected
- Pass through all public routes without modification

## Acceptance criteria
- [ ] `/login` page renders with email and password fields and a sign in button
- [ ] Successful login redirects to `/dashboard`
- [ ] Failed login shows a plain-language error message
- [ ] Navigating to `/dashboard` without a session redirects to `/login`
- [ ] Session persists across page refreshes
- [ ] Sign out clears the session and redirects to `/login`
- [ ] Public result and start list routes are accessible without a session
- [ ] Middleware is in place and correctly protects all organizer routes

## Dependencies
- Story 01 (schema and the Next.js endpoint authorization model must exist)

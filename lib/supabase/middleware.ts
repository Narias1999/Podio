import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public routes are always accessible without a session, even if they also
// match a protected pattern below (e.g. results pages live under /races/...).
const PUBLIC_ROUTE_PATTERNS = [
  /^\/login$/,
  /^\/auth\/callback$/,
  /^\/races\/[^/]+\/results$/,
  /^\/races\/[^/]+\/stages\/[^/]+\/results$/,
  /^\/races\/[^/]+\/stages\/[^/]+\/startlist$/,
];

// Everything else under these patterns requires an authenticated organizer.
const PROTECTED_ROUTE_PATTERNS = [
  /^\/dashboard(\/.*)?$/,
  /^\/races\/new$/,
  /^\/races\/[^/]+\/manage(\/.*)?$/,
  /^\/races\/[^/]+\/stages\/[^/]+\/live(\/.*)?$/,
];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isProtectedRoute(pathname: string) {
  return PROTECTED_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  if (!data.user && !isPublicRoute(pathname) && isProtectedRoute(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return supabaseResponse;
}

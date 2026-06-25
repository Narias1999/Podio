// SERVER-ONLY. This client uses the Supabase service-role key and bypasses all
// authorization. NEVER import this from a client component or expose it to the browser.
// All write endpoints (app/api/...) use this client AFTER authenticating the session and
// verifying the user owns the target race. See the authorization model in Story 01.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

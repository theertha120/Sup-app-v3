import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler(() => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing server configuration");

  // Bound the entire paginated lookup, not each page separately.
  const signal = AbortSignal.timeout(10_000);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
  });
  return (options) => admin.auth.admin.listUsers(options);
}));

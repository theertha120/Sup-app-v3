import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "email is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // The admin API is the only way to check whether an account exists for
    // an email — generateLink errors when there's no matching user, and
    // succeeds (without actually sending anything) when there is.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
    });

    // Only a VERIFIED account counts as registered. An unverified one is a
    // signup that was started but never finished (e.g. the user backed out of
    // the code screen) — signing up again just re-sends the code, so the app
    // must be allowed through instead of being stuck: blocked here, and unable
    // to sign in because the email isn't confirmed.
    const exists = !error && !!data?.user?.email_confirmed_at;

    return new Response(JSON.stringify({ exists }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});

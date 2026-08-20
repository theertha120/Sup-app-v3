import { createClient } from "@supabase/supabase-js";

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
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
    });

    return new Response(JSON.stringify({ exists: !error }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});

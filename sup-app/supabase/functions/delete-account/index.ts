import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function deleteFromTable(table: string, column: string, userId: string) {
  const { error } = await adminClient.from(table).delete().eq(column, userId);
  if (error) {
    console.warn(`[delete-account] Failed to delete from ${table}`, error);
  }
}

async function deleteFriendRequests(userId: string) {
  const { error } = await adminClient
    .from("friend_requests")
    .delete()
    .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

  if (error) {
    console.warn("[delete-account] Failed to delete friend requests", error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await authClient.auth.getUser(token);

    if (userError || !userData.user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const userId = userData.user.id;

    await deleteFriendRequests(userId);
    await deleteFromTable("reminder_log", "user_id", userId);
    await deleteFromTable("behaviour_state", "id", userId);
    await deleteFromTable("user_profile", "id", userId);
    await deleteFromTable("posture_sessions", "user_id", userId);
    await deleteFromTable("posture_daily", "user_id", userId);
    await deleteFromTable("daily_ai_summary", "user_id", userId);
    await deleteFromTable("profiles", "id", userId);

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      return new Response(JSON.stringify({ success: false, error: deleteUserError.message }), {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
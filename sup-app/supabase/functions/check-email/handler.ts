type ListUsers = (
  options: { page: number; perPage: number },
) => Promise<{ data: unknown; error: unknown }>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function createHandler(createLookup: () => ListUsers) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
      const response = json({ error: "Method not allowed" }, 405);
      response.headers.set("Allow", "POST, OPTIONS");
      return response;
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const email = body && typeof body === "object" && "email" in body &&
        typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "A valid email is required" }, 400);
    }
    let page = 1;
    try {
      const listUsers = createLookup();
      // Scan to an empty page, including short pages. Never infer absence from
      // SDK pagination-link parsing or a safety limit being reached.
      for (; page <= 1000; page++) {
        const { data, error } = await listUsers({ page, perPage: 1000 });
        if (error) throw error;
        if (
          !data || typeof data !== "object" || !("users" in data) ||
          !Array.isArray(data.users)
        ) {
          throw new Error("Invalid user list");
        }
        for (const user of data.users) {
          if (
            !user || typeof user !== "object" || typeof user.id !== "string" ||
            (user.email != null && typeof user.email !== "string")
          ) {
            throw new Error("Invalid user record");
          }
          if (user.email?.trim().toLowerCase() === email) {
            return json({ exists: true });
          }
        }
        if (data.users.length === 0) return json({ exists: false });
      }
      throw new Error("Lookup limit reached");
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      console.error("[check-email] lookup failed", {
        page,
        upstreamStatus: typeof status === "number" ? status : undefined,
        // Raw errors can contain emails, tokens or URLs.
        category: status === 401 || status === 403
          ? "credentials"
          : status === 429
          ? "rate_limit"
          : "upstream_or_configuration",
      });
      return json({ error: "Email check unavailable. Please try again." }, 503);
    }
  };
}

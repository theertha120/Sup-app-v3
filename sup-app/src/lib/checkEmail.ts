export const EMAIL_CHECK_UNAVAILABLE =
  "We couldn't check your email right now. Please try again.";

export type EmailCheckResult =
  | { success: true; exists: boolean }
  | { success: false; error: string };

type Invoke = (name: string, options: { body: { email: string } }) =>
  Promise<{ data: unknown; error: unknown }>;

function diagnostic(error: unknown) {
  const value = error as { name?: string; context?: { status?: number } } | null;
  const status = value?.context?.status;
  return {
    status: typeof status === "number" ? status : undefined,
    category: status === 404 ? "not_found"
      : status === 401 || status === 403 ? "authorization"
      : status && status >= 500 ? "backend"
      : value?.name === "FunctionsFetchError" ? "transport"
      : value?.name === "FunctionsRelayError" ? "relay"
      : "invalid_response_or_request",
  };
}

export async function checkEmailRegistered(email: string, invoke: Invoke): Promise<EmailCheckResult> {
  try {
    const { data, error } = await invoke("check-email", {
      body: { email: email.trim().toLowerCase() },
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || !("exists" in data) ||
      typeof data.exists !== "boolean") {
      throw new Error("Invalid email check response");
    }
    return { success: true, exists: data.exists };
  } catch (error) {
    // Never log emails, keys, response bodies, or upstream messages.
    console.warn("[auth] checkEmailRegistered failed", diagnostic(error));
    return { success: false, error: EMAIL_CHECK_UNAVAILABLE };
  }
}

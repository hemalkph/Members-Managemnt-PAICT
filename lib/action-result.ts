export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** Turn a Postgres / Supabase error into a message that is safe to show. */
export function friendlyDbError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "23505":
      return "That name is already in use.";
    case "23503":
      return "This item is still in use (for example, it has logged work), so it can't be removed.";
    case "42501":
      return error.message && !error.message.includes("row-level security")
        ? error.message
        : "You don't have permission to do that.";
    case "23514":
      return "Some values are not allowed. Please check the form.";
    case "PGRST116":
      return "Not found, or you don't have access to it.";
    default:
      return "Something went wrong. Please try again.";
  }
}

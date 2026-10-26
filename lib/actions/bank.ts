"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { ADMINS_CAN_REVEAL_ACCOUNT_NUMBER } from "@/lib/config";
import { bankSchema, fieldErrorsOf, firstError, idSchema, type BankInput } from "@/lib/validation";

export async function saveBankDetailsAction(input: BankInput): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = bankSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const { account_number, ...rest } = parsed.data;

  const { data: existing } = await ctx.supabase
    .from("bank_details")
    .select("user_id")
    .eq("user_id", ctx.profile.id)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await ctx.supabase
      .from("bank_details")
      .update(account_number ? { ...rest, account_number } : rest)
      .eq("user_id", ctx.profile.id));
  } else {
    if (!account_number) {
      return { ok: false, error: "Enter your account number", fieldErrors: { account_number: ["Required"] } };
    }
    ({ error } = await ctx.supabase
      .from("bank_details")
      .insert({ ...rest, account_number, user_id: ctx.profile.id }));
  }

  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/bank");
  return { ok: true, message: "Bank details saved" };
}

/** The owner's full account number, fetched only when they press "Show". */
export async function revealMyAccountNumberAction(): Promise<ActionResult<{ accountNumber: string }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const { data, error } = await ctx.supabase
    .from("bank_details")
    .select("account_number")
    .eq("user_id", ctx.profile.id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "No bank details saved yet." };
  return { ok: true, data: { accountNumber: data.account_number } };
}

/** Only available when ADMINS_CAN_REVEAL_ACCOUNT_NUMBER is true. */
export async function adminRevealAccountNumberAction(input: { id: string }): Promise<ActionResult<{ accountNumber: string }>> {
  if (!ADMINS_CAN_REVEAL_ACCOUNT_NUMBER) return { ok: false, error: "Only the account owner can see the full number." };
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid member." };

  const { data } = await ctx.supabase
    .from("bank_details")
    .select("account_number")
    .eq("user_id", parsed.data.id)
    .maybeSingle();
  if (!data) return { ok: false, error: "No bank details saved." };
  return { ok: true, data: { accountNumber: data.account_number } };
}

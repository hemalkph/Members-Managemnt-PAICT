"use client";

import { useState, useTransition } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetMemberPasswordAction } from "@/lib/actions/admin";
import { strongPassword } from "@/lib/validation";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*-_+?";

function randomIndex(max: number) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/** 16 random characters with at least one upper, lower, number and symbol. */
function generatePassword(length = 16) {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [UPPER, LOWER, DIGITS, SYMBOLS].map((set) => set[randomIndex(set.length)]);
  while (chars.length < length) chars.push(all[randomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Could not copy. Please copy it by hand.");
  }
}

export function ResetPasswordDialog({
  member,
  open,
  onOpenChange,
  canReset,
}: {
  member: { id: string; full_name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canReset: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, startTransition] = useTransition();

  const check = strongPassword.safeParse(password);
  const problem = password && !check.success ? check.error.issues[0]?.message : null;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = check.success && confirm === password;

  const reset = () => {
    setPassword("");
    setConfirm("");
    setVisible(false);
  };

  const onGenerate = () => {
    const value = generatePassword();
    setPassword(value);
    setConfirm(value);
    setVisible(true);
    void copyText(value, "Generated password copied to clipboard");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    startTransition(async () => {
      const result = await resetMemberPasswordAction({ id: member.id, password, confirm });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-3">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <KeyRoundIcon className="size-5" />
            </span>
            <DialogTitle>Reset password</DialogTitle>
          </div>
          <DialogDescription>
            Set a new password for <span className="text-foreground font-medium">{member.full_name}</span>. They&apos;ll
            need to use it on their next login.
          </DialogDescription>
        </DialogHeader>

        {!canReset && (
          <p className="bg-warning/15 rounded-lg p-3 text-sm">
            <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set on the server, so passwords can&apos;t be reset yet.
          </p>
        )}

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-password" className="text-xs tracking-wide uppercase">
                New password
              </Label>
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onGenerate}>
                <SparklesIcon /> Generate
              </Button>
            </div>
            <div className="relative">
              <Input
                id="new-password"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Min 8 chars, upper, lower, number"
                className="pr-20 font-mono"
                value={password}
                aria-invalid={Boolean(problem)}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="absolute inset-y-0 right-1 flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy password"
                  disabled={!password}
                  onClick={() => void copyText(password, "Password copied to clipboard")}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
            {problem && <p className="text-destructive text-sm">{problem}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm-password" className="text-xs tracking-wide uppercase">
              Confirm password
            </Label>
            <Input
              id="confirm-password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Re-enter the password"
              className="font-mono"
              value={confirm}
              aria-invalid={mismatch}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className="text-destructive text-sm">Passwords do not match</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending || !canReset}>
              {pending && <Loader2Icon className="animate-spin" />}
              Reset password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

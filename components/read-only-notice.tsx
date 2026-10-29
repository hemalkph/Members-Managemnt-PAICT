import { EyeIcon } from "lucide-react";

/** Shown on admin pages the account can only look at. */
export function ReadOnlyNotice() {
  return (
    <div className="bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <EyeIcon className="size-4 shrink-0" />
      <span>Read only – you can view this page but not add, change or delete anything.</span>
    </div>
  );
}

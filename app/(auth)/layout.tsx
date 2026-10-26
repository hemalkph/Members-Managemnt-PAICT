import { ClipboardCheckIcon } from "lucide-react";
import Aurora from "@/components/reactbits/aurora";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      {/* CSS fallback (and base) behind the animated aurora */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_60%)]"
      />
      <Aurora className="absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-70 dark:opacity-90" />
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <ClipboardCheckIcon className="size-4" />
          </span>
          Team Work Tracker
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-10">{children}</main>
    </div>
  );
}

import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Public salary receipts (no login, no app shell). */
export default function ReceiptLayout({ children }: LayoutProps<"/receipt">) {
  return (
    <div className="relative flex min-h-svh flex-col">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_60%)]"
      />
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5 font-semibold">
          <BrandLogo className="h-7" priority />
          PA ICT
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-10 sm:items-center sm:pt-0">{children}</main>
    </div>
  );
}

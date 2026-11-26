/** Public salary receipts (no login, no app shell): just the receipt on a soft background. */
export default function ReceiptLayout({ children }: LayoutProps<"/receipt">) {
  return (
    <main className="flex min-h-svh items-start justify-center bg-stone-200 px-4 py-10 sm:pt-16 dark:bg-slate-950">
      {children}
    </main>
  );
}

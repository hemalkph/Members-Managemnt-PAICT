import { Skeleton } from "@/components/ui/skeleton";

/** Instant placeholder shown while a page loads (used by loading.tsx files). */
export function PageSkeleton({
  stats = 0,
  cards = 6,
  layout = "grid",
}: {
  stats?: number;
  cards?: number;
  layout?: "grid" | "list" | "columns";
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      <div
        className={
          layout === "grid"
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : layout === "columns"
              ? "grid gap-4 lg:grid-cols-3"
              : "grid gap-2"
        }
      >
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className={layout === "list" ? "h-20 rounded-xl" : layout === "columns" ? "h-64 rounded-xl" : "h-40 rounded-xl"} />
        ))}
      </div>
    </div>
  );
}

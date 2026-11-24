import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-56 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="bg-card divide-y rounded-xl border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-40 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

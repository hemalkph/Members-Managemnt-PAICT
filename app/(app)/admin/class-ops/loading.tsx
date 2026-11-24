import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      {/* PageHeader */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Top Operations Readiness Ribbon */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-3.5 w-36" />
            </div>
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
      </div>

      {/* Tabs + toolbar actions */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-60 rounded-md" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Grouped 3-zone Class Rows */}
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="bg-card divide-y rounded-xl border">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-3 px-4 py-3.5 lg:grid-cols-[1.4fr_1.15fr_auto] lg:items-center"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-4 w-24 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-52" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-1.5 w-full rounded-full" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-24 rounded-md" />
                    <Skeleton className="h-5 w-16 rounded-md" />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <Skeleton className="h-8 w-44 rounded-md" />
                  <Skeleton className="size-8 rounded-md" />
                  <Skeleton className="size-8 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

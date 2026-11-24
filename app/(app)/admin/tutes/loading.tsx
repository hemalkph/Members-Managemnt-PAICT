import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      {/* PageHeader */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Unified Shelf Readiness Ribbon */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-lg" />
            ))}
          </div>
        </div>
      </div>

      {/* 4-tab bar */}
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Search + toolbar actions */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-64 rounded-md" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Master-Detail Split Skeleton (Shelf Index + Sticky Inspector) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          <Skeleton className="h-4 w-44" />
          <div className="bg-card divide-y rounded-xl border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <Skeleton className="h-11 w-10 shrink-0 rounded-md" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="space-y-1.5">
                    <Skeleton className="ml-auto h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-28" />
                  </div>
                  <Skeleton className="h-8 w-28 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky Inspector Skeleton (desktop) */}
        <div className="bg-card hidden space-y-4 rounded-xl border p-4 lg:block">
          <div className="flex items-start gap-3">
            <Skeleton className="h-14 w-12 shrink-0 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          </div>
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

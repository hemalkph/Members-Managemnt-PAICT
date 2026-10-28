import { PageSkeleton } from "@/components/page-skeleton";
import { RouteLoadingSignal } from "@/components/route-loading";

export default function Loading() {
  return (
    <>
      <RouteLoadingSignal />
      <PageSkeleton stats={4} cards={2} layout="list" />
    </>
  );
}

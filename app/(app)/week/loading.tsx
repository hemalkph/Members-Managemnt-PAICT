import { PageSkeleton } from "@/components/page-skeleton";
import { RouteLoadingSignal } from "@/components/route-loading";

export default function Loading() {
  return (
    <>
      <RouteLoadingSignal />
      <PageSkeleton stats={0} cards={4} layout="list" />
    </>
  );
}

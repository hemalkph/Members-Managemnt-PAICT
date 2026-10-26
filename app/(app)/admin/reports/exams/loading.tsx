import { PageSkeleton } from "@/components/page-skeleton";
import { RouteLoadingSignal } from "@/components/route-loading";

function LoadingView() {
  return <PageSkeleton stats={3} cards={2} layout="columns" />;
}

export default function Loading() {
  return (
    <>
      <RouteLoadingSignal />
      <LoadingView />
    </>
  );
}

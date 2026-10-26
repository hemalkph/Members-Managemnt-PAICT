import { PageSkeleton } from "@/components/page-skeleton";
import { RouteLoadingSignal } from "@/components/route-loading";

function LoadingView() {
  return <PageSkeleton cards={6} layout="list" />;
}

export default function Loading() {
  return (
    <>
      <RouteLoadingSignal />
      <LoadingView />
    </>
  );
}

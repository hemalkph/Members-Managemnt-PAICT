import { TableSkeleton } from "@/components/table-skeleton";
import { RouteLoadingSignal } from "@/components/route-loading";

function LoadingView() {
  return <TableSkeleton />;
}

export default function Loading() {
  return (
    <>
      <RouteLoadingSignal />
      <LoadingView />
    </>
  );
}

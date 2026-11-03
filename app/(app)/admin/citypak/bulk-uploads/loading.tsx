import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return <TableSkeleton rows={8} filters={0} />;
}

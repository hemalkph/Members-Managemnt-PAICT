import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton stats={4} cards={4} layout="list" />;
}

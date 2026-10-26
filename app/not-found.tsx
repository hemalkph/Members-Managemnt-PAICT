import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <EmptyState
        icon={SearchXIcon}
        title="Page not found"
        description="The page you are looking for doesn't exist or you don't have access to it."
        action={
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        }
        className="w-full max-w-md"
      />
    </main>
  );
}

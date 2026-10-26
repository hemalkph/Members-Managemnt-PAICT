import Image from "next/image";
import { cn } from "@/lib/utils";

/** The class logo (public/logo.png, transparent background). Height is set by className. */
export function BrandLogo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/logo.png"
      alt="PA ICT logo"
      width={512}
      height={315}
      priority={priority}
      className={cn("h-8 w-auto object-contain", className)}
    />
  );
}

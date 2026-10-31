"use client";

import * as React from "react";
import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { AnimateIcon } from "@animate-ui/react/icons";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "./button";

/** A link that looks like a button: soft press on tap, and its animated icon plays on hover. */
export function LinkButton({
  href,
  children,
  className,
  ...variants
}: { href: string; children: React.ReactNode; className?: string } & VariantProps<typeof buttonVariants>) {
  return (
    <AnimateIcon animateOnHover className="inline-flex">
      <Button asChild className={className} {...variants}>
        <Link href={href}>{children}</Link>
      </Button>
    </AnimateIcon>
  );
}

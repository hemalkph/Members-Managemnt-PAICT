"use client";

import type { VariantProps } from "class-variance-authority";
import {
  Button as ButtonPrimitive,
  type ButtonProps as ButtonPrimitiveProps,
} from "@animate-ui/react/primitives/buttons/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ButtonProps = ButtonPrimitiveProps & VariantProps<typeof buttonVariants>;

/**
 * Animate UI's button (a soft press on tap, optional grow on hover) with the
 * app's own button styles. Works as a link with `asChild`.
 */
export function Button({ className, variant, size, hoverScale = 1.03, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive className={cn(buttonVariants({ variant, size, className }))} hoverScale={hoverScale} {...props} />
  );
}

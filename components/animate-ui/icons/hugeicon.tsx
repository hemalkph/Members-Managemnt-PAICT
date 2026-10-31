"use client";

import * as React from "react";
import { motion, type SVGMotionProps, type Variants } from "motion/react";
import { IconWrapper, useAnimateIconContext, useIconVariants, type IconProps } from "@animate-ui/react/icons";

/** Hugeicons' free icon data: a list of [tag, attributes] pairs on a 24×24 grid. */
export type HugeiconData = readonly (readonly [string, { readonly [key: string]: string | number }])[];

const TAGS = {
  path: motion.path,
  circle: motion.circle,
  ellipse: motion.ellipse,
  line: motion.line,
  polyline: motion.polyline,
  polygon: motion.polygon,
  rect: motion.rect,
} as const;

/**
 * Turns a Hugeicons free icon into an Animate UI icon (stroke rounded, stroke
 * width 2). Each line draws itself in, one after another, when the icon is
 * triggered: on hover (`animateOnHover`), on tap, in view, or by a parent
 * `AnimateIcon`. People who prefer reduced motion see the still icon.
 */
export function createHugeicon(name: string, data: HugeiconData) {
  const parts = data.filter(([tag]) => tag in TAGS);
  const animations: { default: Record<string, Variants> } = {
    default: Object.fromEntries(
      parts.map((_, i) => [
        `part${i}`,
        {
          initial: { pathLength: 1, opacity: 1 },
          animate: {
            pathLength: [0.05, 1],
            opacity: [0.4, 1],
            transition: { duration: 0.6, delay: i * 0.08, ease: "easeInOut" as const },
          },
        },
      ]),
    ) as Record<string, Variants>,
  };

  function IconComponent({ size, ...props }: IconProps<keyof typeof animations>) {
    const { controls } = useAnimateIconContext();
    const variants = useIconVariants(animations);
    return (
      <motion.svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        {...(props as SVGMotionProps<SVGSVGElement>)}
      >
        {parts.map(([tag, attrs], i) => {
          const Part = TAGS[tag as keyof typeof TAGS] as React.ElementType;
          const rest: Record<string, string | number> = { ...attrs };
          const strokeWidth = rest.strokeWidth;
          delete rest.key;
          delete rest.strokeWidth;
          return (
            <Part
              key={i}
              {...rest}
              strokeWidth={strokeWidth === undefined ? undefined : 2}
              variants={variants[`part${i}`]}
              initial="initial"
              animate={controls}
            />
          );
        })}
      </motion.svg>
    );
  }

  function Icon(props: IconProps<keyof typeof animations>) {
    return <IconWrapper icon={IconComponent} {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

export type HugeiconComponent = ReturnType<typeof createHugeicon>;

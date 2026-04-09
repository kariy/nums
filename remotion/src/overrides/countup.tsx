import { forwardRef, memo } from "react";
import {
  animationVariants,
  type AnimationProps,
} from "@/components/animations";
import { cn } from "@/lib/utils";
import { staticFile } from "remotion";

export const Countup = memo(
  forwardRef<HTMLImageElement, AnimationProps>(
    ({ className, size, ...props }, forwardedRef) => (
      <img
        draggable={false}
        src={staticFile("assets/animations/countup.svg")}
        alt="Countup animation"
        className={cn(animationVariants({ size, className }))}
        ref={forwardedRef}
        {...props}
      />
    ),
  ),
);

Countup.displayName = "Countup";

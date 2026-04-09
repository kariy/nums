import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { useAudio } from "@/context/audio";

export interface NumberProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof numberVariants> {
  value?: number;
  invalid?: boolean;
  sound?: boolean;
}

const numberVariants = cva(
  "select-none relative flex items-center justify-center px-2 py-1",
  {
    variants: {
      variant: {
        default:
          "bg-primary-700 rounded-xl text-white-100 data-[invalid=true]:bg-primary-700 data-[invalid=true]:text-red-100 text-[80px]/[54px] xs:text-[96px]/[63px] md:text-[136px]/[89px] font-normal [&_span]:translate-y-[1.5px] xs:[&_span]:translate-y-[2px] md:[&_span]:translate-y-[3px]  shadow-[1px_1px_0px_0px_rgba(255,255,255,0.12)_inset,1px_1px_0px_0px_rgba(0,0,0,0.12)]",
        secondary:
          "bg-black-800 rounded-lg text-primary-100 text-[40px]/[30px] xs:text-[56px]/[38px] md:text-[88px]/[58px] font-normal [&_span]:translate-y-[1px] xs:[&_span]:translate-y-[1.5px] md:[&_span]:translate-y-[2.5px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const Num = ({
  value = 0,
  invalid = false,
  sound = false,
  variant,
  className,
  style,
  ...props
}: NumberProps) => {
  const { playSlots } = useAudio();
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (!sound) return;
    if (value !== prevValueRef.current) {
      prevValueRef.current = value;
      playSlots();
    }
  }, [value, sound, playSlots]);

  return (
    <div
      data-invalid={invalid}
      className={cn(numberVariants({ variant, className }))}
      style={{
        textShadow: `4px 4px 0px rgba(28, 3, 101, ${variant === "secondary" ? 0.5 : 1})`,
        ...style,
      }}
      {...props}
    >
      <div className="overflow-clip h-full">
        {!value ? (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>???</span>
        ) : (
          <SlidingNumber
            className={
              variant === "secondary"
                ? "[&_[data-slot=sliding-number-roller]]:leading-[38px] md:[&_[data-slot=sliding-number-roller]]:leading-[60px]"
                : "[&_[data-slot=sliding-number-roller]]:leading-[65px] md:[&_[data-slot=sliding-number-roller]]:leading-[92px]"
            }
            number={value}
            padStart={3}
            transition={{ stiffness: 60, damping: 12, mass: 0.8 }}
          />
        )}
      </div>
    </div>
  );
};

import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import {
  RELEASE_NOTES,
  type ReleaseNoteEntry,
  type ReleaseNoteSection,
} from "@/data/release-notes";

export interface ReleaseNotesProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof releaseNotesVariants> {
  onAcknowledge: () => void;
}

const releaseNotesVariants = cva(
  "select-none relative flex flex-col p-6 md:p-12 gap-6 md:gap-10 w-full md:h-[60vh] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "rounded-2xl md:rounded-3xl bg-black-200 border-2 border-black-300 shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)] backdrop-blur-[4px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Section({ title, items }: ReleaseNoteSection) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-lg/5 font-semibold">{title}</h4>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Entry({ date, sections }: ReleaseNoteEntry) {
  return (
    <div className="flex flex-col gap-3">
      <h3
        className="text-xl/5 font-bold uppercase tracking-wide"
        style={{ textShadow: "1px 1px 0px rgba(0, 0, 0, 0.15)" }}
      >
        {date}
      </h3>
      {sections.map((section, i) => (
        <Section key={i} {...section} />
      ))}
    </div>
  );
}

export const ReleaseNotes = ({
  onAcknowledge,
  variant,
  className,
  ...props
}: ReleaseNotesProps) => {
  return (
    <div
      className={cn(releaseNotesVariants({ variant, className }))}
      {...props}
    >
      <h2
        className="text-[36px]/6 md:text-[48px]/[33px] uppercase tracking-wider translate-y-0.5"
        style={{ textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)" }}
      >
        Release Notes
      </h2>

      <div
        className="flex flex-col gap-6 overflow-y-auto font-sans text-base/5 text-white-100"
        style={{ scrollbarWidth: "none" }}
      >
        {RELEASE_NOTES.map((entry, i) => (
          <Entry key={i} {...entry} />
        ))}
      </div>

      <Button
        variant="tertiary"
        className="min-h-12 w-full"
        onClick={onAcknowledge}
      >
        <span
          className="px-1 text-[28px]/[19px] tracking-wide translate-y-0.5"
          style={{ textShadow: "2px 2px 0px rgba(0, 0, 0, 0.24)" }}
        >
          Got it
        </span>
      </Button>
    </div>
  );
};

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaymentStep = { title: string; hint: string; done: boolean };

/** Review → Close → Pay → Payslips, with the next step highlighted. */
export function PaymentSteps({ steps }: { steps: PaymentStep[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Payment steps">
      {steps.map((step, i) => {
        const active = i === current;
        return (
          <li
            key={step.title}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3 transition-colors",
              step.done && "border-success/30 bg-success/5",
              active && "border-primary/50 bg-primary/5 ring-primary/20 ring-2",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                step.done && "bg-success border-success text-white",
                active && "bg-primary border-primary text-primary-foreground",
              )}
            >
              {step.done ? <CheckIcon className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-muted-foreground text-xs">{step.hint}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

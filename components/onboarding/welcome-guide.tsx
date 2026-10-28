"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellRingIcon,
  CalendarDaysIcon,
  FileStackIcon,
  SparklesIcon,
  WalletIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import GradientText from "@/components/reactbits/gradient-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const OPEN_GUIDE_EVENT = "open-welcome-guide";

const seenKey = (userId: string) => `welcome-guide-seen:${userId}`;

const STEPS = [
  {
    icon: SparklesIcon,
    title: "Welcome to the team",
    text: "This is where you see your work, hand papers to the next person and get paid for what you did. Here's how it works in 1 minute.",
  },
  {
    icon: CalendarDaysIcon,
    title: "Know what's next",
    text: "My week shows your paper stages on their work days and your tasks by due date. Overdue work is at the top, so start there.",
    link: { href: "/week", label: "Open My week" },
  },
  {
    icon: FileStackIcon,
    title: "Do your part on a paper",
    text: "Open the paper and follow “Your part”: 1. download the work from the stage before, 2. upload yours, 3. mark your stage done – the next person gets it straight away. Reviews happen on WhatsApp.",
  },
  {
    icon: WalletIcon,
    title: "Get paid",
    text: "Finished type setting or conversion? Add the page count under “Ready to log” in My work. Other work goes in Submit work. My earnings shows every payment and payslip.",
    link: { href: "/payslips", label: "Open My earnings" },
  },
  {
    icon: BellRingIcon,
    title: "Turn on phone alerts",
    text: "Get “Your turn”, approvals and reminders on your phone, even when the app is closed. On iPhone, first add the app to your home screen.",
    link: { href: "/notifications", label: "Turn on alerts" },
  },
];

/**
 * First-login walkthrough. Opens once per person on this device, and again
 * from "Open the quick guide" on the dashboard.
 */
export function WelcomeGuide({ userId, firstName }: { userId: string; firstName: string }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(seenKey(userId)) === "1";
    } catch {
      // Storage blocked: don't keep showing it.
    }
    const timer = seen ? null : setTimeout(() => setOpen(true), 600);
    const onOpen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_GUIDE_EVENT, onOpen);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(OPEN_GUIDE_EVENT, onOpen);
    };
  }, [userId]);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      try {
        window.localStorage.setItem(seenKey(userId), "1");
      } catch {
        // ignore
      }
    }
  };

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="overflow-hidden sm:max-w-md">
        <div className="from-primary/15 to-chart-2/10 -mx-6 -mt-6 flex items-center justify-center bg-gradient-to-br py-6">
          <BrandLogo className="h-12" />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            className="space-y-3"
            initial={{ opacity: 0, x: reduce ? 0 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduce ? 0 : -24 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          >
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
              <s.icon className="size-5" />
            </div>
            <DialogTitle className="text-xl">
              {step === 0 ? (
                <>
                  Hi {firstName}! <GradientText>{s.title}</GradientText>
                </>
              ) : (
                s.title
              )}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">{s.text}</DialogDescription>
            {s.link && (
              <Button asChild variant="link" className="h-auto p-0">
                <Link href={s.link.href} onClick={() => close(false)}>
                  {s.link.label} <ArrowRightIcon />
                </Link>
              </Button>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setStep(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "bg-primary w-5" : "bg-muted-foreground/30 w-1.5",
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                <ArrowLeftIcon /> Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => close(false)}>
                Skip
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? close(false) : setStep(step + 1))}>
              {last ? "Let's go" : "Next"} {!last && <ArrowRightIcon />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

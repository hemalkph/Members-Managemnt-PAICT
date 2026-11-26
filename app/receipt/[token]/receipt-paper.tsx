"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import CountUp from "@/components/reactbits/count-up";
import GlareHover from "@/components/reactbits/glare-hover";
import { cn } from "@/lib/utils";

export type ReceiptLines = {
  firstName: string;
  monthLabel: string;
  payslipNo: string;
  salary: string | null;
  work: string | null;
  items: number;
  total: number;
  paidOn: string;
  reference: string | null;
  bars: { x: number; w: number }[];
};

// Torn bottom edge.
const TORN = {
  mask: "conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 14px 100%",
} as const;
// Faint thermal-paper grain.
const PAPER = {
  backgroundColor: "#fdfcf7",
  backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.018) 0 1px, transparent 1px 3px)",
} as const;

const PRINT_SECONDS = 1.1;

/** A till-roll receipt that prints out of a slot, then gets stamped. `receipt` null = void. */
export function ReceiptPaper({ receipt, organisation }: { receipt: ReceiptLines | null; organisation: string }) {
  const still = useReducedMotion();

  return (
    <div className="w-full max-w-[340px]">
      {/* The printer slot the paper comes out of. */}
      <div className="relative z-10 mx-auto h-5 w-[calc(100%+24px)] -translate-x-3 rounded-full bg-slate-800 shadow-md ring-1 ring-black/20 dark:bg-slate-700">
        <div className="absolute inset-x-5 top-1/2 h-1 -translate-y-1/2 rounded-full bg-black/70" />
      </div>
      <div className="-mt-2.5 overflow-hidden px-0 pt-2.5">
        <motion.div
          initial={still ? false : { y: "-100%" }}
          animate={{ y: 0 }}
          transition={{ duration: PRINT_SECONDS, ease: [0.22, 1, 0.36, 1] }}
        >
          <GlareHover className="block w-full drop-shadow-xl">
            <article
              className="relative w-full px-6 pt-6 pb-10 font-mono text-[13px] leading-relaxed text-slate-800 uppercase"
              style={{ ...PAPER, ...TORN }}
            >
              <Head organisation={organisation} />
              {receipt ? <Paid r={receipt} still={Boolean(still)} /> : <Void still={Boolean(still)} />}
            </article>
          </GlareHover>
        </motion.div>
      </div>
    </div>
  );
}

function Head({ organisation }: { organisation: string }) {
  return (
    <header className="flex flex-col items-center gap-1 text-center">
      <Image src="/logo.png" alt="PA ICT logo" width={512} height={315} className="mb-1 h-8 w-auto" priority />
      <p className="text-base font-bold tracking-widest">PA ICT</p>
      <p className="text-[11px] text-slate-500 normal-case">{organisation}</p>
      <p className="mt-2 font-bold tracking-[0.2em]">*** Salary receipt ***</p>
    </header>
  );
}

const Rule = ({ double = false }: { double?: boolean }) => (
  <hr className={cn("my-3 border-0 border-t-2 border-slate-400", double ? "border-double border-t-4" : "border-dashed")} />
);

function Line({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex items-end gap-2", bold && "font-bold")}>
      <span className="shrink-0">{label}</span>
      <span aria-hidden className="mb-1.5 flex-1 border-b-2 border-dotted border-slate-300" />
      <span className="shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

function Stamp({ text, tone, still, className }: { text: string; tone: "paid" | "void"; still: boolean; className: string }) {
  return (
    <motion.div
      aria-hidden
      initial={still ? false : { scale: 1.8, opacity: 0, rotate: -4 }}
      animate={{ scale: 1, opacity: 0.85, rotate: -12 }}
      transition={{ delay: still ? 0 : PRINT_SECONDS + 0.5, type: "spring", stiffness: 520, damping: 22 }}
      className={cn(
        "pointer-events-none rounded-md border-4 border-double px-3 py-0.5 text-2xl font-black tracking-[0.2em] mix-blend-multiply",
        tone === "paid" ? "border-emerald-700 text-emerald-700" : "border-slate-500 text-slate-500",
        className,
      )}
    >
      {text}
    </motion.div>
  );
}

function Paid({ r, still }: { r: ReceiptLines; still: boolean }) {
  const width = r.bars.length ? r.bars[r.bars.length - 1].x + r.bars[r.bars.length - 1].w : 0;
  return (
    <>
      <Rule />
      <div className="space-y-0.5">
        <Line label="Receipt no" value={r.payslipNo} />
        <Line label="Paid on" value={r.paidOn} />
        <Line label="Month" value={r.monthLabel} />
        <Line label="Paid to" value={r.firstName} />
      </div>
      <Rule />
      <div className="space-y-0.5">
        {r.salary && <Line label="Salary" value={r.salary} />}
        {r.work && <Line label={`Work ×${r.items}`} value={r.work} />}
      </div>
      <Rule double />
      <div className="relative">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold">Total</span>
          <span className="text-2xl font-bold tabular-nums">
            <span className="mr-1 text-sm">Rs.</span>
            <CountUp to={r.total} decimals={2} delay={still ? 0 : PRINT_SECONDS} duration={1} />
          </span>
        </div>
        {r.reference && <p className="mt-1 text-xs text-slate-500">Ref: {r.reference}</p>}
        <Stamp text="Paid" tone="paid" still={still} className="mx-auto mt-5 w-fit" />
      </div>
      <Rule />
      <div className="mt-5 flex flex-col items-center gap-1.5">
        <svg
          viewBox={`-8 0 ${width + 16} 40`}
          className="h-12 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Barcode ${r.payslipNo}`}
        >
          <rect x={-8} width={width + 16} height={40} fill="#fdfcf7" />
          {r.bars.map((b) => (
            <rect key={b.x} x={b.x} width={b.w} height={40} fill="#1e293b" />
          ))}
        </svg>
        <p className="text-[11px] tracking-[0.35em] text-slate-500">{r.payslipNo}</p>
      </div>
      <div className="mt-5 text-center text-xs leading-5">
        <p className="font-bold">Thank you for your work</p>
        <p className="text-slate-500">Keep this receipt for your records</p>
        <p className="mt-2 tracking-[0.5em] text-slate-400">* * *</p>
      </div>
    </>
  );
}

function Void({ still }: { still: boolean }) {
  return (
    <>
      <Rule />
      <div className="relative py-8 text-center">
        <p className="font-bold">This receipt is no longer valid</p>
        <p className="mt-1 text-xs text-slate-500 normal-case">Ask the PA ICT team to send it again.</p>
        <Stamp text="Void" tone="void" still={still} className="absolute top-1 right-2" />
      </div>
      <Rule />
    </>
  );
}

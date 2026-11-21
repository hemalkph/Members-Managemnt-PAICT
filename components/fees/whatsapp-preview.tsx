"use client";

import type { ReactNode } from "react";
import { CheckCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Safely turn WhatsApp inline syntax (*bold*, _italic_, ~strike~) into React nodes
 * without dangerouslySetInnerHTML.
 */
function formatWhatsAppLine(line: string, lineKey: number): ReactNode[] {
  const tokenRe = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const raw = match[0];
    const inner = raw.slice(1, -1);
    const key = `${lineKey}-${idx++}`;
    if (raw.startsWith("*")) {
      parts.push(
        <strong key={key} className="font-semibold">
          {inner}
        </strong>,
      );
    } else if (raw.startsWith("_")) {
      parts.push(
        <em key={key} className="italic">
          {inner}
        </em>,
      );
    } else if (raw.startsWith("~")) {
      parts.push(
        <s key={key} className="line-through opacity-80">
          {inner}
        </s>,
      );
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }
  return parts;
}

/** Realistic WhatsApp-style outgoing bubble preview (supports emojis + *bold* / _italic_ / ~strike~). */
export function WhatsAppPreview({
  text,
  recipientLabel,
  className,
}: {
  text: string;
  recipientLabel?: string;
  className?: string;
}) {
  const lines = text.split("\n");

  return (
    <div
      className={cn(
        "rounded-xl border bg-[#efeae2] p-3.5 dark:bg-[#0b141a]",
        className,
      )}
    >
      {recipientLabel && (
        <p className="mb-2 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          Preview for <span className="text-neutral-900 dark:text-neutral-100">{recipientLabel}</span>
        </p>
      )}
      <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] leading-relaxed text-[#111b21] shadow-xs dark:bg-[#005c4b] dark:text-[#e9edef]">
        <div className="space-y-1 break-words whitespace-pre-wrap">
          {lines.map((line, i) => (
            <p key={i} className={line === "" ? "h-2" : undefined}>
              {formatWhatsAppLine(line, i)}
            </p>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-500 dark:text-emerald-200/80">
          <span>Just now</span>
          <CheckCheckIcon className="size-3.5 text-[#53bdeb]" />
        </div>
      </div>
    </div>
  );
}

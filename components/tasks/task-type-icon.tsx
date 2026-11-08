"use client";

import { LayersIcon } from "lucide-react";
import { Clapperboard } from "@/components/animate-ui/icons/lucide/clapperboard";
import { CloudUpload } from "@/components/animate-ui/icons/lucide/cloud-upload";
import { Upload } from "@/components/animate-ui/icons/lucide/upload";
import { BookOpen } from "@/components/animate-ui/icons/lucide/book-open";
import { BookText } from "@/components/animate-ui/icons/lucide/book-text";
import { GraduationCap } from "@/components/animate-ui/icons/lucide/graduation-cap";
import { FileText } from "@/components/animate-ui/icons/lucide/file-text";
import { Printer } from "@/components/animate-ui/icons/lucide/printer";
import { Pencil } from "@/components/animate-ui/icons/lucide/pencil";
import { Paintbrush } from "@/components/animate-ui/icons/lucide/paintbrush";
import { Palette } from "@/components/animate-ui/icons/lucide/palette";
import { Type } from "@/components/animate-ui/icons/lucide/type";
import { Megaphone } from "@/components/animate-ui/icons/lucide/megaphone";
import { MessageCircle } from "@/components/animate-ui/icons/lucide/message-circle";
import { Send } from "@/components/animate-ui/icons/lucide/send";
import { Camera } from "@/components/animate-ui/icons/lucide/camera";
import { Image } from "@/components/animate-ui/icons/lucide/image";
import { Mic } from "@/components/animate-ui/icons/lucide/mic";
import { Link } from "@/components/animate-ui/icons/lucide/link";
import { CalendarCheck } from "@/components/animate-ui/icons/lucide/calendar-check";
import { ClipboardCheck } from "@/components/animate-ui/icons/lucide/clipboard-check";
import { FolderOpen } from "@/components/animate-ui/icons/lucide/folder-open";
import { LibraryBig } from "@/components/animate-ui/icons/lucide/library-big";
import { NotebookPen } from "@/components/animate-ui/icons/lucide/notebook-pen";
import { Users } from "@/components/animate-ui/icons/lucide/users";
import { Wallet } from "@/components/animate-ui/icons/lucide/wallet";
import { Rocket } from "@/components/animate-ui/icons/lucide/rocket";
import { Flame } from "@/components/animate-ui/icons/lucide/flame";
import { Globe } from "@/components/animate-ui/icons/lucide/globe";
import { Wifi } from "@/components/animate-ui/icons/lucide/wifi";
import { Lightbulb } from "@/components/animate-ui/icons/lucide/lightbulb";
import { Sparkles } from "@/components/animate-ui/icons/lucide/sparkles";
import { Trophy } from "@/components/animate-ui/icons/lucide/trophy";
import { Star } from "@/components/animate-ui/icons/lucide/star";
import { Terminal } from "@/components/animate-ui/icons/lucide/terminal";
import { Layers } from "@/components/animate-ui/icons/lucide/layers";
import { TASK_ICON_NAMES, type TaskColor, type TaskIconName } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/** Animated Lucide icons from animate-ui.com, by name. */
export const TASK_ICONS = {
  clapperboard: Clapperboard,
  "cloud-upload": CloudUpload,
  upload: Upload,
  "book-open": BookOpen,
  "book-text": BookText,
  "graduation-cap": GraduationCap,
  "file-text": FileText,
  printer: Printer,
  pencil: Pencil,
  paintbrush: Paintbrush,
  palette: Palette,
  type: Type,
  megaphone: Megaphone,
  "message-circle": MessageCircle,
  send: Send,
  camera: Camera,
  image: Image,
  mic: Mic,
  link: Link,
  "calendar-check": CalendarCheck,
  "clipboard-check": ClipboardCheck,
  "folder-open": FolderOpen,
  "library-big": LibraryBig,
  "notebook-pen": NotebookPen,
  users: Users,
  wallet: Wallet,
  rocket: Rocket,
  flame: Flame,
  globe: Globe,
  wifi: Wifi,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  trophy: Trophy,
  star: Star,
  terminal: Terminal,
  layers: Layers,
} as const satisfies Record<TaskIconName, unknown>;

/** Tile colours: a soft background and a strong icon colour, in both themes. */
export const TASK_COLOR_CLASSES: Record<TaskColor, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300",
  sky: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  violet: "bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  rose: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
  amber: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
  teal: "bg-teal-500/10 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300",
  orange: "bg-orange-500/10 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300",
  purple: "bg-purple-500/10 text-purple-600 dark:bg-purple-400/15 dark:text-purple-300",
  slate: "bg-slate-500/10 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
};

/** Solid colour dots for the colour picker. */
export const TASK_COLOR_SWATCHES: Record<TaskColor, string> = {
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  slate: "bg-slate-500",
};

const isIconName = (icon: string | null): icon is TaskIconName =>
  icon !== null && (TASK_ICON_NAMES as readonly string[]).includes(icon);

/**
 * A task type's icon on its coloured tile. The icon animates on hover (or
 * always, with `animate`); older types with an emoji show the emoji.
 */
export function TaskTypeIcon({
  icon,
  color,
  size = 18,
  animate,
  className,
}: {
  icon: string | null;
  color: TaskColor;
  size?: number;
  animate?: boolean;
  className?: string;
}) {
  const Icon = isIconName(icon) ? TASK_ICONS[icon] : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg",
        TASK_COLOR_CLASSES[color] ?? TASK_COLOR_CLASSES.blue,
        className,
      )}
    >
      {Icon ? (
        <Icon size={size} animate={animate} animateOnHover />
      ) : icon ? (
        <span style={{ fontSize: size }}>{icon}</span>
      ) : (
        <LayersIcon style={{ width: size, height: size }} />
      )}
    </span>
  );
}

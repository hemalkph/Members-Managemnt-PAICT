"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  BoldIcon,
  CopyIcon,
  ItalicIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  SmilePlusIcon,
  StarIcon,
  StrikethroughIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppPreview } from "@/components/fees/whatsapp-preview";
import { deleteFeeTemplateAction, saveFeeTemplateAction } from "@/lib/actions/fees";
import type { FeeTemplateItem } from "@/lib/fees/queries";
import { EMOJI_GROUPS, renderFeeMessage, TEMPLATE_VARIABLES, type FeeMessageContext } from "@/lib/fees/templates";
import { cn } from "@/lib/utils";

const BLANK_BODY = `Hi {first_name} 👋✨

This is a friendly reminder regarding your *{class}* fee for *{month}* ({amount}) ⏳.

Please settle it at your earliest convenience 📚🙏.

Thank you! 🌟`;

export function TemplateEditor({
  templates,
  sampleContext,
  canEdit,
  onTemplatesChanged,
}: {
  templates: FeeTemplateItem[];
  sampleContext: FeeMessageContext;
  canEdit: boolean;
  onTemplatesChanged?: () => void;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initial = templates[0] ?? null;

  const [selectedId, setSelectedId] = useState<string | "new">(initial?.id ?? "new");
  const [name, setName] = useState(initial?.name ?? "New Reminder");
  const [body, setBody] = useState(initial?.body ?? BLANK_BODY);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? templates.length === 0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Keep isDefault synced when the server promotes another template after a delete/save refresh.
  const [prevTemplates, setPrevTemplates] = useState(templates);
  if (templates !== prevTemplates) {
    setPrevTemplates(templates);
    if (selectedId !== "new") {
      const updated = templates.find((t) => t.id === selectedId);
      if (updated) {
        setIsDefault(updated.isDefault);
      } else if (templates[0]) {
        setSelectedId(templates[0].id);
        setName(templates[0].name);
        setBody(templates[0].body);
        setIsDefault(templates[0].isDefault);
      }
    }
  }

  const selectTemplate = (t: FeeTemplateItem) => {
    setSelectedId(t.id);
    setName(t.name);
    setBody(t.body);
    setIsDefault(t.isDefault);
  };

  const startNew = (fromTemplate?: FeeTemplateItem) => {
    setSelectedId("new");
    setName(fromTemplate ? `${fromTemplate.name} (Copy)` : "");
    setBody(fromTemplate ? fromTemplate.body : BLANK_BODY);
    setIsDefault(templates.length === 0);
  };

  /** Insert an emoji or placeholder token at the current cursor position. */
  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => `${prev}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${snippet}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /** Wrap selected text in WhatsApp formatting (*bold*, _italic_, ~strike~). */
  const wrapSelection = (marker: "*" | "_" | "~", placeholder: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || placeholder;
    const wrapped = `${marker}${selected}${marker}`;
    const next = `${body.slice(0, start)}${wrapped}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1 + selected.length);
    });
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveFeeTemplateAction({
        id: selectedId === "new" ? undefined : selectedId,
        name: name.trim(),
        body: body.trim(),
        is_default: isDefault,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      if (res.data?.id) setSelectedId(res.data.id);
      onTemplatesChanged?.();
      router.refresh();
    });
  };

  const remove = () => {
    if (selectedId === "new") return;
    startTransition(async () => {
      const res = await deleteFeeTemplateAction(selectedId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      const next = templates.find((t) => t.id !== selectedId);
      if (next) selectTemplate(next);
      else startNew();
      onTemplatesChanged?.();
      router.refresh();
    });
  };

  const renderedPreview = renderFeeMessage(body, sampleContext);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Left rail: saved templates */}
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Saved templates</CardTitle>
            {canEdit && (
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => startNew()}>
                <PlusIcon /> New
              </Button>
            )}
          </div>
          <CardDescription>Shared across your team. Customize text &amp; emojis any time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTemplate(t)}
              className={cn(
                "flex w-full items-start justify-between gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                selectedId === t.id
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted/60 border-transparent bg-muted/30",
              )}
            >
              <span className="line-clamp-2 min-w-0 flex-1">{t.name}</span>
              {t.isDefault && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  <StarIcon className="size-2.5 fill-current" /> Default
                </Badge>
              )}
            </button>
          ))}
          {selectedId === "new" && (
            <div className="border-primary bg-primary/5 rounded-lg border border-dashed p-2.5 text-sm font-medium">
              + Unsaved new template
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right panel: composer + live WhatsApp bubble preview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                {selectedId === "new" ? "Create WhatsApp template" : "Edit WhatsApp template"}
              </CardTitle>
              <CardDescription>
                Add emojis, WhatsApp bold/italic formatting, and dynamic student details.
              </CardDescription>
            </div>
            {canEdit && selectedId !== "new" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const cur = templates.find((t) => t.id === selectedId);
                  if (cur) startNew(cur);
                }}
              >
                <CopyIcon /> Duplicate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-name">Template name</Label>
                  <Input
                    id="tpl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. 1st Friendly Reminder, Final Notice"
                    disabled={!canEdit}
                    maxLength={80}
                    required
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch
                    id="tpl-default"
                    checked={isDefault}
                    onCheckedChange={setIsDefault}
                    disabled={!canEdit}
                  />
                  <Label htmlFor="tpl-default" className="cursor-pointer text-xs font-medium">
                    Default template
                  </Label>
                </div>
              </div>

              {/* Formatting + Emoji Picker toolbar */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="tpl-body">Message body</Label>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="Bold (*text*)"
                        onClick={() => wrapSelection("*", "bold text")}
                      >
                        <BoldIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="Italic (_text_)"
                        onClick={() => wrapSelection("_", "italic text")}
                      >
                        <ItalicIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="Strikethrough (~text~)"
                        onClick={() => wrapSelection("~", "text")}
                      >
                        <StrikethroughIcon className="size-3.5" />
                      </Button>

                      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                            <SmilePlusIcon className="size-3.5" /> Add emoji
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-72 space-y-3 p-3">
                          {EMOJI_GROUPS.map((group) => (
                            <div key={group.label} className="space-y-1">
                              <p className="text-muted-foreground text-[11px] font-medium">{group.label}</p>
                              <div className="flex flex-wrap gap-1">
                                {group.emojis.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => {
                                      insertAtCursor(emoji);
                                    }}
                                    className="hover:bg-accent flex size-8 items-center justify-center rounded-md text-lg transition-colors"
                                    aria-label={`Insert ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>

                <Textarea
                  ref={textareaRef}
                  id="tpl-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={9}
                  maxLength={3000}
                  disabled={!canEdit}
                  spellCheck={false}
                  className="font-sans text-sm leading-relaxed"
                  placeholder="Write or paste your customizable WhatsApp message (English or Helakuru Sinhala Unicode + emojis)..."
                  required
                />

                {/* Placeholder variable chips */}
                {canEdit && (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">
                      Supports <strong>Sinhala Unicode (Helakuru Unicode mode)</strong> &amp; emojis. Tap a placeholder
                      to insert student details:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v.token}
                          type="button"
                          onClick={() => insertAtCursor(v.token)}
                          title={`Inserts ${v.label} (e.g. ${v.example})`}
                          className="bg-muted hover:bg-accent hover:text-accent-foreground rounded-md border px-2 py-0.5 font-mono text-xs transition-colors"
                        >
                          {v.token}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  {selectedId !== "new" && templates.length > 1 ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="destructive" size="sm" disabled={pending}>
                          <Trash2Icon /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete template &ldquo;{name}&rdquo;?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Past follow-up counts will be kept, but this template will be removed from the list.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={remove}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete template
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <span className="text-muted-foreground text-xs">{body.length} / 3,000 characters</span>
                  )}

                  <Button type="submit" disabled={pending || name.trim().length < 2 || body.trim().length < 5}>
                    {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                    {selectedId === "new" ? "Save template" : "Save changes"}
                  </Button>
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className="space-y-2">
              <p className="text-xs font-semibold">Live WhatsApp Preview</p>
              <WhatsAppPreview
                text={renderedPreview}
                recipientLabel={`${sampleContext.fullName} · ${sampleContext.className}`}
              />
              <p className="text-muted-foreground text-xs">
                Messages open via <code className="text-[11px]">api.whatsapp.com</code> so emojis and Sinhala/Unicode
                text stay completely intact.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

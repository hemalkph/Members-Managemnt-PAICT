"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileIcon, Link2Icon, Loader2Icon, PaperclipIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSubmissionAction, updateSubmissionAction } from "@/lib/actions/submissions";
import { formatBytes } from "@/lib/format";
import { monthLabel } from "@/lib/month";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_LINKS,
  submissionSchema,
  type AttachmentInput,
  type SubmissionInput,
} from "@/lib/validation";

type RoleOption = { id: string; name: string; sectionName: string };
type ExistingAttachment = { id: string; file_name: string; size_bytes: number };
type NewAttachment = AttachmentInput & { key: string };

function safeFileName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-100) || "file";
}

export function SubmissionForm({
  userId,
  roles,
  months,
  today,
  defaultValues,
  submissionId,
  existingAttachments = [],
}: {
  userId: string;
  roles: RoleOption[];
  months: string[];
  today: string;
  defaultValues: SubmissionInput;
  submissionId?: string;
  existingAttachments?: ExistingAttachment[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<NewAttachment[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  const form = useForm<SubmissionInput>({
    resolver: zodResolver(submissionSchema),
    defaultValues,
  });
  const links = useFieldArray({ control: form.control, name: "links" });

  const keptExisting = existingAttachments.filter((a) => !removedIds.includes(a.id));
  const fileCount = keptExisting.length + newFiles.length + uploading.length;

  const groups = new Map<string, RoleOption[]>();
  for (const role of roles) groups.set(role.sectionName, [...(groups.get(role.sectionName) ?? []), role]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (fileCount + list.length > MAX_ATTACHMENTS) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const supabase = createClient();
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is larger than 10 MB.`);
        continue;
      }
      const key = crypto.randomUUID();
      setUploading((u) => [...u, key]);
      const path = `${userId}/${key}/${safeFileName(file.name)}`;
      const { error } = await supabase.storage
        .from("attachments")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      setUploading((u) => u.filter((k) => k !== key));
      if (error) {
        toast.error(`Could not upload ${file.name}.`);
        continue;
      }
      setNewFiles((f) => [
        ...f,
        { key, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type || null, size_bytes: file.size },
      ]);
    }
  };

  const removeNewFile = async (file: NewAttachment) => {
    setNewFiles((f) => f.filter((x) => x.key !== file.key));
    await createClient().storage.from("attachments").remove([file.storage_path]);
  };

  const onSubmit = (values: SubmissionInput) => {
    if (uploading.length > 0) {
      toast.error("Please wait for the files to finish uploading.");
      return;
    }
    startTransition(async () => {
      const payload = {
        ...values,
        attachments: newFiles.map((f) => ({
          storage_path: f.storage_path,
          file_name: f.file_name,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
        })),
        removed_attachment_ids: removedIds,
      };
      const result = submissionId
        ? await updateSubmissionAction(submissionId, payload)
        : await createSubmissionAction(payload);

      if (!result.ok) {
        toast.error(result.error);
        for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (name in values && messages?.[0]) form.setError(name as keyof SubmissionInput, { message: messages[0] });
        }
        return;
      }
      toast.success(result.message);
      router.push(`/work?month=${values.work_month}`);
      router.refresh();
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="work_month"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Month</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a month" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m} value={m}>
                        {monthLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose one of your roles" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {[...groups.entries()].map(([section, items]) => (
                      <SelectGroup key={section}>
                        <SelectLabel>{section}</SelectLabel>
                        {items.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Marked Term Test 2 papers" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (optional)</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="Add any details the admin should know" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={Number.isFinite(field.value) ? field.value : ""}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                </FormControl>
                <FormDescription>e.g. papers marked or designs made</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date_done"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date done</FormLabel>
                <FormControl>
                  <Input type="date" max={today} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Links */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Links (optional)</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={links.fields.length >= MAX_LINKS}
              onClick={() => links.append({ url: "" })}
            >
              <PlusIcon /> Add link
            </Button>
          </div>
          {links.fields.length === 0 && (
            <p className="text-muted-foreground text-xs">Google Drive, Canva or any other link to your work.</p>
          )}
          {links.fields.map((item, index) => (
            <FormField
              key={item.id}
              control={form.control}
              name={`links.${index}.url`}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <Link2Icon className="text-muted-foreground size-4 shrink-0" />
                    <FormControl>
                      <Input type="url" inputMode="url" placeholder="https://" {...field} />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove link"
                      onClick={() => links.remove(index)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>

        {/* Attachments */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Attachments (optional)</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fileCount >= MAX_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon /> Add files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Up to {MAX_ATTACHMENTS} files, 10 MB each. Files are private to you and the admins.
          </p>
          {(keptExisting.length > 0 || newFiles.length > 0 || uploading.length > 0) && (
            <ul className="divide-y rounded-lg border">
              {keptExisting.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
                  <span className="text-muted-foreground text-xs">{formatBytes(a.size_bytes)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${a.file_name}`}
                    onClick={() => setRemovedIds((ids) => [...ids, a.id])}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
              {newFiles.map((a) => (
                <li key={a.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileIcon className="text-primary size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
                  <span className="text-muted-foreground text-xs">{formatBytes(a.size_bytes)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${a.file_name}`}
                    onClick={() => void removeNewFile(a)}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
              {uploading.map((key) => (
                <li key={key} className="text-muted-foreground flex items-center gap-3 px-3 py-2 text-sm">
                  <Loader2Icon className="size-4 animate-spin" /> Uploading…
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <SubmitButton pending={pending} disabled={uploading.length > 0}>
            {submissionId ? "Save changes" : "Submit work"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}

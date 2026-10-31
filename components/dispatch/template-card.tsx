"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2Icon, DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { storeTemplateAction, verifyTemplateAction } from "@/lib/actions/dispatch-rounds";
import { createClient } from "@/lib/supabase/client";

export type StoredTemplate = { id: string; fileName: string; columns: string[]; verified: boolean; when: string } | null;

/** Citypak's blank upload template. The export stays off until a main admin verifies it. */
export function TemplateCard({ template, canChange }: { template: StoredTemplate; canChange: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = () =>
    startTransition(async () => {
      if (!file) return;
      const lower = file.name.toLowerCase();
      const ext = lower.endsWith(".xlsx") ? "xlsx" : lower.endsWith(".csv") ? "csv" : null;
      if (!ext) return void toast.error("Upload the template as .xlsx or .csv.");
      const path = `templates/${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient()
        .storage.from("dispatch")
        .upload(path, file, {
          contentType: ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: false,
        });
      if (error) return void toast.error("The upload failed. Please try again.");
      const result = await storeTemplateAction({ path, file_name: file.name });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setFile(null);
      router.refresh();
    });

  const verify = (verified: boolean) =>
    startTransition(async () => {
      if (!template) return;
      const result = await verifyTemplateAction({ file_id: template.id, verified });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Citypak upload template
          {template && (template.verified ? <Badge variant="success">Verified</Badge> : <Badge variant="warning">Not verified</Badge>)}
        </CardTitle>
        <CardDescription>
          The blank bulk-upload file from Citypak. The courier export stays switched off until this is stored and verified, so
          no column value is guessed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {template ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{template.fileName}</span> <span className="text-muted-foreground">· {template.when}</span>
            </p>
            <p className="text-muted-foreground text-xs">Columns: {template.columns.join(" · ") || "none found"}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/admin/dispatch/files/${template.id}`}>
                  <DownloadIcon /> Download
                </a>
              </Button>
              {canChange &&
                (template.verified ? (
                  <Button variant="outline" size="sm" onClick={() => verify(false)} disabled={pending}>
                    Mark not verified
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => verify(true)} disabled={pending}>
                    <CheckCircle2Icon /> I checked it – mark verified
                  </Button>
                ))}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No template stored yet.</p>
        )}
        {canChange && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sm:max-w-sm" aria-label="Citypak template" />
            <Button variant="outline" onClick={upload} disabled={!file || pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {template ? "Replace template" : "Upload template"}
            </Button>
          </div>
        )}
        {!canChange && <p className="text-muted-foreground text-xs">Only main admins (with two-step login) can change this.</p>}
      </CardContent>
    </Card>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { FilmIcon, RefreshCwIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  driveThumbnailUrl,
  formatDuration,
  VIDEO_SOURCES,
  type DriveVideosResponse,
  type PickedVideo,
  type VideoSource,
} from "@/lib/work/drive-videos";
import { formatBytes } from "@/lib/core/format";
import { MAX_DRIVE_VIDEOS } from "@/lib/core/validation";
import { cn } from "@/lib/utils";

/**
 * Tick the videos you edited in the team's Google Drive folder
 * (Social Media Videos → month → Edited / External edits).
 */
export function DriveVideoPicker({
  value,
  onChange,
  submissionId,
}: {
  value: PickedVideo[];
  onChange: (videos: PickedVideo[]) => void;
  /** When editing: this entry's own videos aren't "already logged". */
  submissionId?: string;
}) {
  // null = the server picks this month's folder.
  const [monthId, setMonthId] = useState<string | null>(null);
  const [source, setSource] = useState<VideoSource>("edited");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; data: DriveVideosResponse } | null>(null);

  const key = `${monthId}|${source}|${reload}`;
  const loading = result?.key !== key;
  const data = result?.data;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ source });
    if (monthId) params.set("month", monthId);
    if (submissionId) params.set("submission", submissionId);
    fetch(`/api/drive/videos?${params}`, { signal: controller.signal })
      .then((res) => res.json() as Promise<DriveVideosResponse>)
      .then((body) => setResult({ key, data: body }))
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setResult({ key, data: { ok: false, error: "Couldn't reach Google Drive. Check your internet and try again." } });
        }
      });
    return () => controller.abort();
  }, [key, monthId, source, submissionId]);

  const picked = new Set(value.map((v) => v.id));
  const toggle = (video: PickedVideo, on: boolean) => {
    if (on && value.length >= MAX_DRIVE_VIDEOS) return;
    onChange(on ? [...value, video] : value.filter((v) => v.id !== video.id));
  };

  const months = data?.ok ? data.months : [];
  const currentMonth = data?.ok ? data.monthId : null;
  const monthName = months.find((m) => m.id === currentMonth)?.name;

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={currentMonth ?? undefined} onValueChange={setMonthId} disabled={months.length === 0}>
          <SelectTrigger className="sm:w-48" aria-label="Month folder">
            <SelectValue placeholder="Month folder" />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs value={source} onValueChange={(v) => setSource(v as VideoSource)}>
          <TabsList>
            {(Object.keys(VIDEO_SOURCES) as VideoSource[]).map((s) => (
              <TabsTrigger key={s} value={s}>
                {VIDEO_SOURCES[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="sm:ml-auto"
          onClick={() => setReload((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCwIcon className={cn(loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-video rounded-lg" />
          ))}
        </div>
      ) : !data?.ok ? (
        <p className="bg-muted/50 rounded-lg p-3 text-sm" role="alert">
          {data?.error ?? "Couldn't load the videos."}
        </p>
      ) : data.videos.length === 0 ? (
        <p className="text-muted-foreground bg-muted/50 rounded-lg p-3 text-sm">
          {monthName
            ? `No videos in ${monthName} → ${VIDEO_SOURCES[source]} yet. Upload them to Google Drive, then tap Refresh.`
            : "No month folders in Social Media Videos yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.videos.map((video) => {
            const on = picked.has(video.id);
            const meta = [formatDuration(video.durationMs), video.sizeBytes ? formatBytes(video.sizeBytes) : null]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={video.id}>
                <label
                  className={cn(
                    "bg-card block cursor-pointer overflow-hidden rounded-lg border transition-shadow",
                    on && "ring-primary ring-2",
                    video.claimed && "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="bg-muted relative aspect-video">
                    <FilmIcon className="text-muted-foreground absolute inset-0 m-auto size-6" />
                    <Image
                      src={driveThumbnailUrl(video.id)}
                      alt=""
                      fill
                      unoptimized
                      sizes="(min-width: 640px) 33vw, 50vw"
                      className="object-cover"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    <Checkbox
                      checked={on}
                      disabled={video.claimed}
                      onCheckedChange={(v) => toggle({ id: video.id, name: video.name }, v === true)}
                      className="bg-background absolute top-2 left-2 size-5"
                      aria-label={video.name}
                    />
                    {video.claimed && (
                      <Badge variant="secondary" className="absolute right-2 bottom-2">
                        {video.claimedByMe ? "In your other entry" : "Already logged"}
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-0.5 p-2">
                    <span className="truncate text-sm font-medium" title={video.name}>
                      {video.name}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {[meta, video.uploadedBy].filter(Boolean).join(" · ") || " "}
                    </span>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {value.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">
            {value.length} video{value.length > 1 ? "s" : ""} selected
          </p>
          <div className="flex flex-wrap gap-1.5">
            {value.map((v) => (
              <span key={v.id} className="bg-muted inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs">
                <span className="truncate">{v.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label={`Remove ${v.name}`}
                  onClick={() => toggle(v, false)}
                >
                  <XIcon className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

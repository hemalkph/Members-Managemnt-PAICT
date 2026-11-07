import Image from "next/image";
import { ExternalLinkIcon, FilmIcon } from "lucide-react";
import { driveThumbnailUrl, driveViewUrl, formatDuration, VIDEO_SOURCES, type VideoSource } from "@/lib/work/drive-videos";

export type SavedVideo = {
  drive_file_id: string;
  name: string;
  source: VideoSource;
  folder_name: string | null;
  duration_ms: number | null;
};

/** The Drive videos logged in a work entry; each opens in Google Drive. */
export function DriveVideoList({ videos }: { videos: SavedVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {videos.map((v) => (
        <li key={v.drive_file_id}>
          <a
            href={driveViewUrl(v.drive_file_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:bg-muted/50 flex items-center gap-3 px-3 py-2"
          >
            <span className="bg-muted relative aspect-video w-16 shrink-0 overflow-hidden rounded">
              <FilmIcon className="text-muted-foreground absolute inset-0 m-auto size-4" />
              <Image src={driveThumbnailUrl(v.drive_file_id)} alt="" fill unoptimized sizes="64px" className="object-cover" />
            </span>
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{v.name}</span>
              <span className="text-muted-foreground truncate text-xs">
                {[v.folder_name, VIDEO_SOURCES[v.source], formatDuration(v.duration_ms)].filter(Boolean).join(" · ")}
              </span>
            </span>
            <ExternalLinkIcon className="text-muted-foreground size-4 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

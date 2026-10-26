"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { CameraIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { removeAvatarAction, setAvatarAction } from "@/lib/actions/profile";
import { initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { MAX_AVATAR_BYTES } from "@/lib/validation";

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function AvatarUploader({
  userId,
  name,
  avatarUrl,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const ext = TYPES[file.type];
    if (!ext) return toast.error("Please choose a JPG, PNG, WebP or GIF image.");
    if (file.size > MAX_AVATAR_BYTES) return toast.error("The photo must be 5 MB or smaller.");

    startTransition(async () => {
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error } = await createClient()
        .storage.from("avatars")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        toast.error("Upload failed. Please try again.");
        return;
      }
      const result = await setAvatarAction({ path });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  const onRemove = () =>
    startTransition(async () => {
      const result = await removeAvatarAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-20 text-lg">
        {avatarUrl && <AvatarImage src={avatarUrl} alt="Your profile photo" />}
        <AvatarFallback className="text-xl">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="grid gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
          {pending ? <Loader2Icon className="animate-spin" /> : <CameraIcon />}
          {avatarUrl ? "Change photo" : "Upload photo"}
        </Button>
        {avatarUrl && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
            <Trash2Icon /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

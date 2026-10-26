import type { Metadata } from "next";
import { CakeIcon, UserRoundPenIcon } from "lucide-react";
import { RolesList } from "@/components/member/roles-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { ageOn, formatBirthday } from "@/lib/birthday";
import { todayISO } from "@/lib/month";
import { missingProfileFields } from "@/lib/profile-completion";
import { getMemberRoles } from "@/lib/queries";
import { signedAvatarUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { AvatarUploader } from "./avatar-uploader";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await requireUser();
  const missing = missingProfileFields(profile);
  const supabase = await createClient();
  const [roles, avatarUrl] = await Promise.all([
    getMemberRoles(supabase, profile.id),
    signedAvatarUrl(supabase, profile.avatar_path),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Keep your contact details up to date." />
      {missing.length > 0 && (
        <div className="border-primary/30 bg-primary/5 flex gap-3 rounded-xl border p-4">
          <UserRoundPenIcon className="text-primary mt-0.5 size-5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Please complete your profile</p>
            <p className="text-muted-foreground">
              {profile.is_admin
                ? "Add these details to complete your profile: "
                : "You can submit work once your profile is complete. Still needed: "}
              <span className="text-foreground font-medium">{missing.join(", ")}</span>
            </p>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>Signed in as {profile.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              defaultValues={{
                full_name: profile.full_name,
                phone: profile.phone ?? "",
                whatsapp: profile.whatsapp ?? "",
                nic: profile.nic ?? "",
              }}
            />
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile photo</CardTitle>
              <CardDescription>JPG, PNG or WebP, up to 5 MB.</CardDescription>
            </CardHeader>
            <CardContent>
              <AvatarUploader userId={profile.id} name={profile.full_name} avatarUrl={avatarUrl} />
            </CardContent>
          </Card>
          {profile.date_of_birth && (
            <Card>
              <CardContent className="flex items-center gap-3">
                <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                  <CakeIcon className="size-5" />
                </span>
                <div>
                  <p className="text-muted-foreground text-xs">Birthday (from your NIC)</p>
                  <p className="font-medium">
                    {formatBirthday(profile.date_of_birth)} · {ageOn(profile.date_of_birth, todayISO())} years
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>My roles</CardTitle>
              <CardDescription>Assigned by an admin.</CardDescription>
            </CardHeader>
            <CardContent>
              <RolesList roles={roles} emptyText="No roles yet. Ask an admin to assign your roles." />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

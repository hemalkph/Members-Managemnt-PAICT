import type { Metadata } from "next";
import { RolesList } from "@/components/member/roles-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getMemberRoles } from "@/lib/queries";
import { signedAvatarUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { AvatarUploader } from "./avatar-uploader";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await requireUser();
  const supabase = await createClient();
  const [roles, avatarUrl] = await Promise.all([
    getMemberRoles(supabase, profile.id),
    signedAvatarUrl(supabase, profile.avatar_path),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Keep your contact details up to date." />
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

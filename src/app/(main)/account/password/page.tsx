import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { PasswordForm } from "../forms";

export default async function ChangePasswordPage() {
  const me = await requireUser();
  return (
    <>
      <PageHeader title="Change password" description={me.must_change_password ? "You must set a new password before you can continue." : "Choose a new password for your account."} />
      <CardSection><PasswordForm /></CardSection>
    </>
  );
}

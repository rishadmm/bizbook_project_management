import { redirect } from "next/navigation";
import { requirePage } from "@/lib/auth";

export default async function AdminIndex() {
  await requirePage("users");
  redirect("/admin/users");
}

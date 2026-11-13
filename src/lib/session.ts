import { requireUser, type AuthUser } from "./auth";

/** The signed-in user (real session). Redirects to /login when there is none. Signature kept for existing module code. */
export async function getCurrentUser(): Promise<AuthUser> {
  return requireUser();
}

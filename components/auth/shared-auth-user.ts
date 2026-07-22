import type { AuthContextValue } from "./AuthProvider";

export function isCurrentSharedAuthUser(
  auth: AuthContextValue | null,
  expectedUserId: string
): boolean {
  return (
    auth === null ||
    (auth.state.status === "authenticated" &&
      auth.state.user.id === expectedUserId)
  );
}

import type { AuthContext } from "./session";
import { personalizationError } from "./errors";

export type OwnedWhere<TIdentity extends object> = Omit<TIdentity, "userId"> & {
  userId: string;
};

export type FindOwnedResource<TIdentity extends object, TResource> = (
  where: OwnedWhere<TIdentity>
) => Promise<TResource | null>;

export function ownedWhere<TIdentity extends object>(
  auth: AuthContext,
  identity: TIdentity & { userId?: never }
): OwnedWhere<TIdentity> {
  return {
    ...identity,
    userId: auth.user.id
  };
}

export async function requireOwnedResource<TIdentity extends object, TResource>(
  auth: AuthContext,
  identity: TIdentity & { userId?: never },
  findOwned: FindOwnedResource<TIdentity, TResource>
): Promise<TResource> {
  const resource = await findOwned(ownedWhere(auth, identity));

  if (resource === null) {
    throw personalizationError("NOT_FOUND");
  }

  return resource;
}

export function requireActionPermission(allowed: boolean): asserts allowed {
  if (!allowed) {
    throw personalizationError("FORBIDDEN");
  }
}

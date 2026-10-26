export const USERS_PERMISSIONS = {
  list: "users:list",
  count: "users:count",
} as const;

export type UsersPermission =
  (typeof USERS_PERMISSIONS)[keyof typeof USERS_PERMISSIONS];

export type PlatformRole = "user" | "admin" | "super-admin";

const ALLOWED_ROLES: Readonly<
  Record<UsersPermission, readonly PlatformRole[]>
> = {
  [USERS_PERMISSIONS.list]: ["admin", "super-admin"],
  [USERS_PERMISSIONS.count]: ["admin", "super-admin"],
};

/** Pure, exact-match, default-deny policy for direct management-web roles. */
export function hasUsersPermission(
  directClientRoles: readonly string[] | null | undefined,
  permission: UsersPermission,
): boolean {
  const allowedRoles = ALLOWED_ROLES[permission];

  if (!Array.isArray(directClientRoles) || allowedRoles === undefined) {
    return false;
  }

  return directClientRoles.some(role =>
    allowedRoles.includes(role as PlatformRole),
  );
}

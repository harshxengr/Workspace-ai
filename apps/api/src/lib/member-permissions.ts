import type { WorkspaceRole } from "./document-permissions";

/**
 * Only workspace owners and admins can add new members.
 */
export function canAddWorkspaceMembers(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Only owners can grant the ADMIN role.
 * Ownership cannot be granted through member assignment.
 */
export function canAssignWorkspaceRole(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  if (targetRole === "OWNER") {
    return false;
  }

  if (actorRole === "OWNER") {
    return true;
  }

  if (actorRole !== "ADMIN") {
    return false;
  }

  return (
    targetRole === "EDITOR" ||
    targetRole === "MEMBER" ||
    targetRole === "VIEWER"
  );
}

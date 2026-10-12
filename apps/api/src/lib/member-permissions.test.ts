import { describe, expect, test } from "bun:test";

import {
  canAddWorkspaceMembers,
  canAssignWorkspaceRole,
} from "./member-permissions";
import type { WorkspaceRole } from "./document-permissions";

const roles: WorkspaceRole[] = ["OWNER", "ADMIN", "EDITOR", "MEMBER", "VIEWER"];

describe("Workspace member permissions", () => {
  test("only owners and admins can add members", () => {
    expect(canAddWorkspaceMembers("OWNER")).toBe(true);
    expect(canAddWorkspaceMembers("ADMIN")).toBe(true);
    expect(canAddWorkspaceMembers("EDITOR")).toBe(false);
    expect(canAddWorkspaceMembers("MEMBER")).toBe(false);
    expect(canAddWorkspaceMembers("VIEWER")).toBe(false);
  });

  test("owners can grant any non-owner role", () => {
    for (const role of roles) {
      expect(canAssignWorkspaceRole("OWNER", role)).toBe(role !== "OWNER");
    }
  });

  test("admins cannot grant admin or owner privileges", () => {
    expect(canAssignWorkspaceRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignWorkspaceRole("ADMIN", "OWNER")).toBe(false);
  });

  test("admins can grant editor, member, and viewer roles", () => {
    expect(canAssignWorkspaceRole("ADMIN", "EDITOR")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "MEMBER")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "VIEWER")).toBe(true);
  });

  test("non-admin roles cannot assign other roles", () => {
    const nonAdminRoles: WorkspaceRole[] = ["EDITOR", "MEMBER", "VIEWER"];

    for (const actorRole of nonAdminRoles) {
      for (const targetRole of roles) {
        expect(canAssignWorkspaceRole(actorRole, targetRole)).toBe(false);
      }
    }
  });

  test("ownership cannot be granted to another member", () => {
    for (const actorRole of roles) {
      expect(canAssignWorkspaceRole(actorRole, "OWNER")).toBe(false);
    }
  });
});

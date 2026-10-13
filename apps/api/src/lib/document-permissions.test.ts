import { describe, expect, test } from "bun:test";

import {
  canCreateDocument,
  canEditDocument,
  canDeleteDocument,
  type WorkspaceRole,
} from "./document-permissions";

const permissionCases: Array<{
  role: WorkspaceRole;
  create: boolean;
  edit: boolean;
  delete: boolean;
}> = [
  {
    role: "OWNER",
    create: true,
    edit: true,
    delete: true,
  },
  {
    role: "ADMIN",
    create: true,
    edit: true,
    delete: true,
  },
  {
    role: "EDITOR",
    create: true,
    edit: true,
    delete: false,
  },
  {
    role: "MEMBER",
    create: true,
    edit: false,
    delete: false,
  },
  {
    role: "VIEWER",
    create: false,
    edit: false,
    delete: false,
  },
];

describe("Workspace document permissions", () => {
  for (const permissions of permissionCases) {
    describe(permissions.role, () => {
      test("document creation permission", () => {
        expect(canCreateDocument(permissions.role)).toBe(permissions.create);
      });

      test("document editing permission", () => {
        expect(canEditDocument(permissions.role)).toBe(permissions.edit);
      });

      test("document deletion permission", () => {
        expect(canDeleteDocument(permissions.role)).toBe(permissions.delete);
      });
    });
  }
});

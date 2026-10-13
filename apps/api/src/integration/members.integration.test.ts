import "dotenv/config";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@workspace/db";

const API_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PASSWORD = "Integration-Password-123!";
const FRONTEND_ORIGIN = "http://localhost:3000";

type TestActor = {
  id: string;
  email: string;
  cookie: string;
};

type TestTargets = {
  ownerAdmin: string;
  adminAdmin: string;
  adminEditor: string;
  editorMember: string;
  viewerMember: string;
  outsiderMember: string;
  duplicate: string;
  ownerRole: string;
};

let apiProcess: Bun.Subprocess | null = null;
let apiPort = 0;
let collaborationPort = 0;
let apiBaseUrl = "";

let owner!: TestActor;
let admin!: TestActor;
let editor!: TestActor;
let viewer!: TestActor;
let outsider!: TestActor;

let workspaceId = "";
let outsiderWorkspaceId = "";
let targets!: TestTargets;

const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getFreePort(): number {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("port probe"),
  });

  const port = server.port;
  server.stop(true);

  if (typeof port !== "number") {
    throw new Error("Bun did not allocate an available port.");
  }

  return port;
}

function initializePorts(): void {
  apiPort = getFreePort();

  do {
    collaborationPort = getFreePort();
  } while (collaborationPort === apiPort);

  apiBaseUrl = `http://127.0.0.1:${apiPort}`;
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (apiProcess && apiProcess.exitCode !== null) {
      throw new Error(
        `API process exited early with code ${apiProcess.exitCode}`,
      );
    }

    const [apiResponse, collaborationResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/health`).catch(() => null),
      fetch(`http://127.0.0.1:${collaborationPort}/`).catch(() => null),
    ]);

    if (apiResponse?.ok && collaborationResponse?.ok) {
      return;
    }

    await sleep(250);
  }

  throw new Error(
    "API and collaboration server did not become ready within 15 seconds.",
  );
}

async function startApiServer(): Promise<void> {
  initializePorts();

  const childEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  childEnv.NODE_ENV = "test";
  childEnv.WEB_ORIGINS = FRONTEND_ORIGIN;
  childEnv.PORT = String(apiPort);
  childEnv.COLLAB_PORT = String(collaborationPort);
  childEnv.BETTER_AUTH_URL = apiBaseUrl;

  apiProcess = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd: API_DIRECTORY,
    env: childEnv,
    stdout: "inherit",
    stderr: "inherit",
  });

  await waitForServer();
}

async function stopApiServer(): Promise<void> {
  const processToStop = apiProcess;
  apiProcess = null;

  if (!processToStop) {
    return;
  }

  if (processToStop.exitCode === null) {
    processToStop.kill("SIGTERM");
  }

  const result = await Promise.race([
    processToStop.exited,
    sleep(5000).then(() => null),
  ]);

  if (result === null) {
    processToStop.kill("SIGKILL");
    await processToStop.exited;
  }
}

async function createAuthUser(label: string): Promise<TestActor> {
  const email = `members-${label}-${crypto.randomUUID()}@example.test`;

  const response = await fetch(`${apiBaseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: FRONTEND_ORIGIN,
    },
    body: JSON.stringify({
      name: `Member Test ${label}`,
      email,
      password: PASSWORD,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not register ${label}: ${response.status} ${await response.text()}`,
    );
  }

  const cookieParts = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean);

  if (cookieParts.length === 0) {
    throw new Error(`No session cookie returned for ${label}.`);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`Registered user ${label} was not found in PostgreSQL.`);
  }

  createdUserIds.push(user.id);

  return {
    id: user.id,
    email,
    cookie: cookieParts.join("; "),
  };
}

async function createTargetUser(label: string): Promise<string> {
  const email = `members-target-${label}-${crypto.randomUUID()}@example.test`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Member Target ${label}`,
    },
    select: { id: true, email: true },
  });

  createdUserIds.push(user.id);

  return user.email;
}

async function createWorkspace(label: string, suffix: string): Promise<string> {
  const workspace = await prisma.workspace.create({
    data: {
      name: `Member Authorization ${label}`,
      slug: `member-auth-${label}-${suffix}`,
    },
    select: { id: true },
  });

  createdWorkspaceIds.push(workspace.id);

  return workspace.id;
}

async function postMember(
  actor: TestActor | null,
  targetEmail: string,
  role?: string,
  targetWorkspaceId = workspaceId,
): Promise<Response> {
  const headers = new Headers({
    origin: FRONTEND_ORIGIN,
    "content-type": "application/json",
  });

  if (actor) {
    headers.set("cookie", actor.cookie);
  }

  const body: { email: string; role?: string } = {
    email: targetEmail,
  };

  if (role !== undefined) {
    body.role = role;
  }

  return fetch(`${apiBaseUrl}/api/workspaces/${targetWorkspaceId}/members`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for integration tests.");
  }

  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required for integration tests.");
  }

  await startApiServer();

  const suffix = crypto.randomUUID().slice(0, 8);

  owner = await createAuthUser("owner");
  admin = await createAuthUser("admin");
  editor = await createAuthUser("editor");
  viewer = await createAuthUser("viewer");
  outsider = await createAuthUser("outsider");

  workspaceId = await createWorkspace("primary", suffix);
  outsiderWorkspaceId = await createWorkspace("outsider", `${suffix}-other`);

  await prisma.workspaceMember.createMany({
    data: [
      {
        workspaceId,
        userId: owner.id,
        role: "OWNER",
      },
      {
        workspaceId,
        userId: admin.id,
        role: "ADMIN",
      },
      {
        workspaceId,
        userId: editor.id,
        role: "EDITOR",
      },
      {
        workspaceId,
        userId: viewer.id,
        role: "VIEWER",
      },
      {
        workspaceId: outsiderWorkspaceId,
        userId: outsider.id,
        role: "OWNER",
      },
    ],
  });

  const [
    ownerAdmin,
    adminAdmin,
    adminEditor,
    editorMember,
    viewerMember,
    outsiderMember,
    duplicate,
    ownerRole,
  ] = await Promise.all([
    createTargetUser("owner-admin"),
    createTargetUser("admin-admin"),
    createTargetUser("admin-editor"),
    createTargetUser("editor-member"),
    createTargetUser("viewer-member"),
    createTargetUser("outsider-member"),
    createTargetUser("duplicate"),
    createTargetUser("owner-role"),
  ]);

  targets = {
    ownerAdmin,
    adminAdmin,
    adminEditor,
    editorMember,
    viewerMember,
    outsiderMember,
    duplicate,
    ownerRole,
  };

  const duplicateUser = await prisma.user.findUniqueOrThrow({
    where: { email: targets.duplicate },
    select: { id: true },
  });

  await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: duplicateUser.id,
      role: "MEMBER",
    },
  });
}, 60_000);

afterAll(async () => {
  await stopApiServer();

  try {
    if (createdWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}, 30_000);

test("owner can add an ADMIN", async () => {
  const response = await postMember(owner, targets.ownerAdmin, "ADMIN");

  expect(response.status).toBe(201);

  const body = (await response.json()) as {
    member: { userId: string; role: string };
  };

  expect(body.member.role).toBe("ADMIN");

  const target = await prisma.user.findUniqueOrThrow({
    where: { email: targets.ownerAdmin },
    select: { id: true },
  });

  expect(body.member.userId).toBe(target.id);
});

test("admin cannot grant ADMIN privileges", async () => {
  const response = await postMember(admin, targets.adminAdmin, "ADMIN");

  expect(response.status).toBe(403);

  const target = await prisma.user.findUniqueOrThrow({
    where: { email: targets.adminAdmin },
    select: { id: true },
  });

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: target.id,
      },
    },
  });

  expect(membership).toBeNull();
});

test("admin can add an EDITOR", async () => {
  const response = await postMember(admin, targets.adminEditor, "EDITOR");

  expect(response.status).toBe(201);

  const body = (await response.json()) as {
    member: { role: string };
  };

  expect(body.member.role).toBe("EDITOR");
});

test("editor cannot add workspace members", async () => {
  const response = await postMember(editor, targets.editorMember, "MEMBER");

  expect(response.status).toBe(403);
});

test("viewer cannot add workspace members", async () => {
  const response = await postMember(viewer, targets.viewerMember, "MEMBER");

  expect(response.status).toBe(403);
});

test("a member of another workspace cannot add members here", async () => {
  const response = await postMember(
    outsider,
    targets.outsiderMember,
    "MEMBER",
    workspaceId,
  );

  expect(response.status).toBe(403);
});

test("cannot add a user who is already a workspace member", async () => {
  const response = await postMember(owner, targets.duplicate, "MEMBER");

  expect(response.status).toBe(409);
});

test("the invitation endpoint rejects attempts to assign OWNER", async () => {
  const response = await postMember(owner, targets.ownerRole, "OWNER");

  expect(response.status).toBe(400);
});

test("unauthenticated requests cannot add members", async () => {
  const response = await postMember(null, targets.ownerAdmin, "MEMBER");

  expect(response.status).toBe(401);
});

type ManagedMemberRole = "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER";

async function createManagedMember(
  label: string,
  role: ManagedMemberRole = "MEMBER",
  targetWorkspaceId = workspaceId,
): Promise<{ id: string; userId: string }> {
  const email = await createTargetUser(label);

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId: targetWorkspaceId,
      userId: user.id,
      role,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  return member;
}

async function patchMemberRole(
  actor: TestActor | null,
  memberId: string,
  role: string,
  targetWorkspaceId = workspaceId,
): Promise<Response> {
  const headers = new Headers({
    origin: FRONTEND_ORIGIN,
    "content-type": "application/json",
  });

  if (actor) {
    headers.set("cookie", actor.cookie);
  }

  return fetch(
    `${apiBaseUrl}/api/workspaces/${targetWorkspaceId}/members/${memberId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ role }),
    },
  );
}

async function removeMember(
  actor: TestActor | null,
  memberId: string,
  targetWorkspaceId = workspaceId,
): Promise<Response> {
  const headers = new Headers({
    origin: FRONTEND_ORIGIN,
  });

  if (actor) {
    headers.set("cookie", actor.cookie);
  }

  return fetch(
    `${apiBaseUrl}/api/workspaces/${targetWorkspaceId}/members/${memberId}`,
    {
      method: "DELETE",
      headers,
    },
  );
}

test("workspace owner can change a member role", async () => {
  const target = await createManagedMember("role-change");
  const response = await patchMemberRole(owner, target.id, "VIEWER");

  expect(response.status).toBe(200);

  const updated = await prisma.workspaceMember.findUniqueOrThrow({
    where: { id: target.id },
  });

  expect(updated.role).toBe("VIEWER");
});

test("admin cannot change another member's role", async () => {
  const target = await createManagedMember("admin-role-change");
  const response = await patchMemberRole(admin, target.id, "EDITOR");

  expect(response.status).toBe(403);

  const unchanged = await prisma.workspaceMember.findUniqueOrThrow({
    where: { id: target.id },
  });

  expect(unchanged.role).toBe("MEMBER");
});

test("workspace owner cannot change or remove the owner membership", async () => {
  const ownerMembership = await prisma.workspaceMember.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: owner.id,
      },
    },
    select: { id: true },
  });

  const changeResponse = await patchMemberRole(
    owner,
    ownerMembership.id,
    "ADMIN",
  );

  expect(changeResponse.status).toBe(403);

  const removeResponse = await removeMember(owner, ownerMembership.id);

  expect(removeResponse.status).toBe(403);
});

test("workspace owner can remove a non-owner member", async () => {
  const target = await createManagedMember("owner-remove");
  const response = await removeMember(owner, target.id);

  expect(response.status).toBe(204);

  const removed = await prisma.workspaceMember.findUnique({
    where: { id: target.id },
  });

  expect(removed).toBeNull();
});

test("admin cannot remove a workspace member", async () => {
  const target = await createManagedMember("admin-remove");
  const response = await removeMember(admin, target.id);

  expect(response.status).toBe(403);

  const unchanged = await prisma.workspaceMember.findUnique({
    where: { id: target.id },
  });

  expect(unchanged).not.toBeNull();
});

test("member management cannot target a membership from another workspace", async () => {
  const target = await createManagedMember(
    "foreign-workspace",
    "MEMBER",
    outsiderWorkspaceId,
  );

  const response = await patchMemberRole(owner, target.id, "VIEWER");

  expect(response.status).toBe(404);

  const unchanged = await prisma.workspaceMember.findUniqueOrThrow({
    where: { id: target.id },
  });

  expect(unchanged.role).toBe("MEMBER");
});

test("unauthenticated requests cannot change or remove members", async () => {
  const target = await createManagedMember("unauthenticated-management");

  const changeResponse = await patchMemberRole(null, target.id, "VIEWER");

  expect(changeResponse.status).toBe(401);

  const removeResponse = await removeMember(null, target.id);

  expect(removeResponse.status).toBe(401);
});

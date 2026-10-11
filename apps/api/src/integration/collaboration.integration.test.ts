
import "dotenv/config";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { createCollaborationToken } from "@workspace/auth";
import { prisma } from "@workspace/db";

const API_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const COLLABORATION_FIELD = "default";
const CONNECTION_TIMEOUT_MS = 12_000;

type TestClient = {
  document: Y.Doc;
  provider: HocuspocusProvider;
};

type Fixture = {
  documentId: string;
  workspaceId: string;
  ownerToken: string;
  viewerToken: string;
};

let fixture: Fixture | null = null;
let apiProcess: Bun.Subprocess | null = null;

let apiPort = 0;
let collaborationPort = 0;
let apiBaseUrl = "";
let collaborationUrl = "";
let restoreCookie = "";

let createdWorkspaceId: string | null = null;
const createdUserIds: string[] = [];
const activeClients = new Set<TestClient>();

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendParagraph(document: Y.Doc, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  const textNode = new Y.XmlText();

  textNode.insert(0, text);
  paragraph.insert(0, [textNode]);

  const fragment = document.getXmlFragment(COLLABORATION_FIELD);
  fragment.insert(fragment.length, [paragraph]);
}

function extractXmlText(
  node: Y.XmlFragment | Y.XmlElement | Y.XmlText,
): string {
  if (node instanceof Y.XmlText) {
    return node.toString();
  }

  return node
    .toArray()
    .map((child) => {
      if (child instanceof Y.XmlText) {
        return child.toString();
      }

      if (child instanceof Y.XmlElement) {
        return extractXmlText(child);
      }

      return "";
    })
    .join("");
}

async function waitForDocumentText(
  document: Y.Doc,
  expected: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const content = extractXmlText(
      document.getXmlFragment(COLLABORATION_FIELD),
    );

    if (content.includes(expected)) {
      return;
    }

    await sleep(50);
  }

  throw new Error(`Timed out waiting for synchronized text: ${expected}`);
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
  if (apiPort !== 0) {
    return;
  }

  apiPort = getFreePort();

  do {
    collaborationPort = getFreePort();
  } while (collaborationPort === apiPort);

  apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  collaborationUrl = `ws://127.0.0.1:${collaborationPort}`;
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

function disposeClient(client: TestClient): void {
  client.provider.destroy();
  client.document.destroy();
  activeClients.delete(client);
}

async function connectClient(
  documentId: string,
  token: string,
): Promise<TestClient> {
  const document = new Y.Doc();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveSynced!: () => void;
  let rejectSynced!: (error: Error) => void;

  const synced = new Promise<void>((resolve, reject) => {
    resolveSynced = resolve;
    rejectSynced = reject;

    timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for collaboration sync."));
    }, CONNECTION_TIMEOUT_MS);
  });

  const provider = new HocuspocusProvider({
    url: collaborationUrl,
    name: documentId,
    document,
    token,

    onSynced() {
      if (timeout) {
        clearTimeout(timeout);
      }

      resolveSynced();
    },

    onAuthenticationFailed({ reason }) {
      if (timeout) {
        clearTimeout(timeout);
      }

      rejectSynced(
        new Error(`Collaboration authentication failed: ${reason}`),
      );
    },
  });

  try {
    await synced;

    const client = { document, provider };
    activeClients.add(client);
    return client;
  } catch (error) {
    provider.destroy();
    document.destroy();
    throw error;
  }
}

async function readPersistedText(
  documentId: string,
): Promise<string | null> {
  const record = await prisma.document.findUnique({
    where: { id: documentId },
    select: { collaborationState: true },
  });

  if (!record?.collaborationState?.byteLength) {
    return null;
  }

  const restoredDocument = new Y.Doc();

  try {
    Y.applyUpdate(
      restoredDocument,
      new Uint8Array(record.collaborationState),
    );

    return extractXmlText(
      restoredDocument.getXmlFragment(COLLABORATION_FIELD),
    );
  } finally {
    restoredDocument.destroy();
  }
}

async function waitForPersistedText(
  documentId: string,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const savedText = await readPersistedText(documentId);

    if (savedText?.includes(expected)) {
      return;
    }

    await sleep(250);
  }

  throw new Error(
    `Expected collaborative text was not persisted: ${expected}`,
  );
}

async function createRestoreSession(email: string): Promise<string> {
  const response = await fetch(
    `${apiBaseUrl}/api/auth/sign-up/email`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name: "Integration Restorer",
        email,
        password: "Integration-Password-123!",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not create the integration session: ${response.status} ${await response.text()}`,
    );
  }

  const cookieParts = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean);

  if (cookieParts.length === 0) {
    throw new Error(
      "Better Auth did not return a session cookie for the integration test.",
    );
  }

  return cookieParts.join("; ");
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for collaboration integration tests.",
    );
  }

  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for collaboration integration tests.",
    );
  }

  const suffix = crypto.randomUUID();
  const shortSuffix = suffix.slice(0, 8);

  const owner = await prisma.user.create({
    data: {
      email: `integration-owner-${suffix}@example.test`,
      name: "Integration Owner",
    },
  });
  createdUserIds.push(owner.id);

  const viewer = await prisma.user.create({
    data: {
      email: `integration-viewer-${suffix}@example.test`,
      name: "Integration Viewer",
    },
  });
  createdUserIds.push(viewer.id);

  const workspace = await prisma.workspace.create({
    data: {
      name: `Integration Workspace ${shortSuffix}`,
      slug: `collab-integration-${suffix}`,
    },
  });
  createdWorkspaceId = workspace.id;

  await prisma.workspaceMember.createMany({
    data: [
      {
        workspaceId: workspace.id,
        userId: owner.id,
        role: "OWNER",
      },
      {
        workspaceId: workspace.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    ],
  });

  const document = await prisma.document.create({
    data: {
      title: "Collaboration integration fixture",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Integration test document",
              },
            ],
          },
        ],
      },
      workspaceId: workspace.id,
      authorId: owner.id,
    },
  });

  fixture = {
    documentId: document.id,
    workspaceId: workspace.id,
    ownerToken: await createCollaborationToken({
      userId: owner.id,
      documentId: document.id,
      name: "Integration Owner",
      color: "#2563eb",
    }),
    viewerToken: await createCollaborationToken({
      userId: viewer.id,
      documentId: document.id,
      name: "Integration Viewer",
      color: "#64748b",
    }),
  };

  await startApiServer();

  const restorerEmail = `integration-restorer-${suffix}@example.test`;
  restoreCookie = await createRestoreSession(restorerEmail);

  const restorer = await prisma.user.findUnique({
    where: { email: restorerEmail },
    select: { id: true },
  });

  if (!restorer) {
    throw new Error("The integration restorer user was not created.");
  }

  createdUserIds.push(restorer.id);

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: restorer.id,
      role: "OWNER",
    },
  });
}, 60_000);

afterAll(async () => {
  for (const client of [...activeClients]) {
    disposeClient(client);
  }

  await stopApiServer();

  try {
    if (createdWorkspaceId) {
      await prisma.workspace.deleteMany({
        where: { id: createdWorkspaceId },
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

test(
  "synchronizes editor clients, rejects viewer writes, restores through the API, and survives restart",
  async () => {
    if (!fixture) {
      throw new Error("Integration fixture was not initialized.");
    }

    const ownerClient = await connectClient(
      fixture.documentId,
      fixture.ownerToken,
    );

    const viewerClient = await connectClient(
      fixture.documentId,
      fixture.viewerToken,
    );

    const ownerFragment = ownerClient.document.getXmlFragment(
      COLLABORATION_FIELD,
    );
    const viewerFragment = viewerClient.document.getXmlFragment(
      COLLABORATION_FIELD,
    );

    const originalMarker = `owner-write-${crypto.randomUUID()}`;
    appendParagraph(ownerClient.document, originalMarker);

    // A real update must reach the second WebSocket client.
    await waitForDocumentText(viewerClient.document, originalMarker);
    expect(extractXmlText(viewerFragment)).toContain(originalMarker);

    await waitForPersistedText(fixture.documentId, originalMarker);

    // Attempt a write as a read-only viewer. The server must reject it.
    const forbiddenText = `viewer-write-${crypto.randomUUID()}`;
    appendParagraph(viewerClient.document, forbiddenText);

    await sleep(5500);

    expect(extractXmlText(ownerFragment)).not.toContain(forbiddenText);

    const persistedBeforeRestore = await readPersistedText(
      fixture.documentId,
    );

    expect(persistedBeforeRestore).toContain(originalMarker);
    expect(persistedBeforeRestore).not.toContain(forbiddenText);

    // Disconnect the viewer so it cannot retain a local rejected edit.
    disposeClient(viewerClient);

    // Create a saved snapshot with known content and restore it through
    // the real authenticated Express route.
    const restoredMarker = `restored-snapshot-${crypto.randomUUID()}`;

    const restoredContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: restoredMarker,
            },
          ],
        },
      ],
    };

    const version = await prisma.documentVersion.create({
      data: {
        documentId: fixture.documentId,
        content: restoredContent,
      },
    });

    const restoreResponse = await fetch(
      `${apiBaseUrl}/api/documents/${fixture.documentId}/versions/${version.id}/restore`,
      {
        method: "POST",
        headers: {
          cookie: restoreCookie,
          origin: "http://localhost:3000",
        },
      },
    );

    if (!restoreResponse.ok) {
      throw new Error(
        `Restore route failed: ${restoreResponse.status} ${await restoreResponse.text()}`,
      );
    }

    const restoreBody = (await restoreResponse.json()) as {
      document: {
        id: string;
        content: unknown;
      };
    };

    expect(restoreBody.document.id).toBe(fixture.documentId);

    // The already-connected editor should receive the server-side
    // restoration through Yjs, without a second frontend mutation.
    await waitForDocumentText(ownerClient.document, restoredMarker);

    const liveTextAfterRestore = extractXmlText(ownerFragment);

    expect(liveTextAfterRestore).toContain(restoredMarker);
    expect(liveTextAfterRestore).not.toContain(originalMarker);
    expect(liveTextAfterRestore).not.toContain(forbiddenText);

    // Verify both JSON and binary Yjs state in PostgreSQL.
    await waitForPersistedText(fixture.documentId, restoredMarker);

    const persistedAfterRestore = await prisma.document.findUnique({
      where: { id: fixture.documentId },
      select: {
        content: true,
        collaborationState: true,
      },
    });

    expect(persistedAfterRestore).not.toBeNull();
    expect(persistedAfterRestore?.collaborationState?.byteLength).toBeGreaterThan(0);

    const persistedText = await readPersistedText(fixture.documentId);

    expect(persistedText).toContain(restoredMarker);
    expect(persistedText).not.toContain(originalMarker);
    expect(persistedText).not.toContain(forbiddenText);

    // Restart the real API + collaboration process and reconnect fresh.
    disposeClient(ownerClient);
    await sleep(250);
    await stopApiServer();
    await startApiServer();

    const reconnectedOwner = await connectClient(
      fixture.documentId,
      fixture.ownerToken,
    );

    const reconnectedText = extractXmlText(
      reconnectedOwner.document.getXmlFragment(COLLABORATION_FIELD),
    );

    expect(reconnectedText).toContain(restoredMarker);
    expect(reconnectedText).not.toContain(originalMarker);
  },
  120_000,
);

import "dotenv/config";

import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { createCollaborationToken } from "@workspace/auth";
import { prisma } from "@workspace/db";

const API_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const COLLABORATION_FIELD = "default";
const CONNECTION_TIMEOUT_MS = 12_000;
const PERSISTENCE_ACK_TYPE = "workspace-ai:document-persisted";

type PersistenceAcknowledgement = {
  type: typeof PERSISTENCE_ACK_TYPE;
  contentHash: string;
  savedAt: string;
};

type TestClient = {
  document: Y.Doc;
  provider: HocuspocusProvider;
  persistenceAcknowledgements: PersistenceAcknowledgement[];
};

type Fixture = {
  documentId: string;
  ownerToken: string;
  editorToken: string;
};

let fixture: Fixture | null = null;
let apiProcess: Bun.Subprocess | null = null;

let apiPort = 0;
let collaborationPort = 0;
let apiBaseUrl = "";
let collaborationUrl = "";

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

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }

  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, normalizeJson(object[key])]),
    );
  }

  return value;
}

function hashJsonContent(value: unknown): string {
  const serialized = JSON.stringify(normalizeJson(value)) ?? "null";

  return createHash("sha256").update(serialized).digest("hex");
}

function parsePersistenceAcknowledgement(
  payload: string,
): PersistenceAcknowledgement | null {
  try {
    const parsed: unknown = JSON.parse(payload);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const message = parsed as Record<string, unknown>;

    if (
      message.type !== PERSISTENCE_ACK_TYPE ||
      typeof message.contentHash !== "string" ||
      typeof message.savedAt !== "string" ||
      Number.isNaN(Date.parse(message.savedAt))
    ) {
      return null;
    }

    return {
      type: PERSISTENCE_ACK_TYPE,
      contentHash: message.contentHash,
      savedAt: message.savedAt,
    };
  } catch {
    return null;
  }
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

async function waitForProviderEvent(
  provider: HocuspocusProvider,
  eventName: "disconnect" | "synced",
  timeoutMs = CONNECTION_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const handler = () => {
      if (timeout) {
        clearTimeout(timeout);
      }

      provider.off(eventName, handler);
      resolve();
    };

    timeout = setTimeout(() => {
      provider.off(eventName, handler);
      reject(
        new Error(
          `Timed out waiting for collaboration provider event: ${eventName}`,
        ),
      );
    }, timeoutMs);

    provider.on(eventName, handler);
  });
}

async function waitForPersistenceAcknowledgement(
  client: TestClient,
  expectedHash: string,
  timeoutMs = 15_000,
): Promise<PersistenceAcknowledgement> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const acknowledgement = client.persistenceAcknowledgements.find(
      (item) => item.contentHash === expectedHash,
    );

    if (acknowledgement) {
      return acknowledgement;
    }

    await sleep(50);
  }

  throw new Error(
    `Timed out waiting for a persistence acknowledgement matching ${expectedHash}.`,
  );
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
  const persistenceAcknowledgements: PersistenceAcknowledgement[] = [];

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

      rejectSynced(new Error(`Collaboration authentication failed: ${reason}`));
    },

    onStateless({ payload }) {
      const acknowledgement = parsePersistenceAcknowledgement(payload);

      if (acknowledgement) {
        persistenceAcknowledgements.push(acknowledgement);
      }
    },
  });

  try {
    await synced;

    const client = {
      document,
      provider,
      persistenceAcknowledgements,
    };

    activeClients.add(client);

    return client;
  } catch (error) {
    provider.destroy();
    document.destroy();
    throw error;
  }
}

async function readPersistedText(documentId: string): Promise<string | null> {
  const record = await prisma.document.findUnique({
    where: { id: documentId },
    select: { collaborationState: true },
  });

  if (!record?.collaborationState?.byteLength) {
    return null;
  }

  const restoredDocument = new Y.Doc();

  try {
    Y.applyUpdate(restoredDocument, new Uint8Array(record.collaborationState));

    return extractXmlText(restoredDocument.getXmlFragment(COLLABORATION_FIELD));
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

  throw new Error(`Expected collaborative text was not persisted: ${expected}`);
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
      email: `reconnect-owner-${suffix}@example.test`,
      name: "Reconnect Test Owner",
    },
  });
  createdUserIds.push(owner.id);

  const editor = await prisma.user.create({
    data: {
      email: `reconnect-editor-${suffix}@example.test`,
      name: "Reconnect Test Editor",
    },
  });
  createdUserIds.push(editor.id);

  const workspace = await prisma.workspace.create({
    data: {
      name: `Reconnect Test Workspace ${shortSuffix}`,
      slug: `collaboration-reconnect-${suffix}`,
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
        userId: editor.id,
        role: "EDITOR",
      },
    ],
  });

  const document = await prisma.document.create({
    data: {
      title: "Collaboration reconnect fixture",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Reconnect integration fixture",
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

    ownerToken: await createCollaborationToken({
      userId: owner.id,
      documentId: document.id,
      name: "Reconnect Test Owner",
      color: "#2563eb",
    }),

    editorToken: await createCollaborationToken({
      userId: editor.id,
      documentId: document.id,
      name: "Reconnect Test Editor",
      color: "#7c3aed",
    }),
  };

  await startApiServer();
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

test("reconnects and merges offline and online edits without losing either", async () => {
  if (!fixture) {
    throw new Error("Integration fixture was not initialized.");
  }

  let ownerClient: TestClient | null = null;
  let editorClient: TestClient | null = null;

  try {
    ownerClient = await connectClient(fixture.documentId, fixture.ownerToken);

    editorClient = await connectClient(fixture.documentId, fixture.editorToken);

    const offlineMarker = `offline-edit-${crypto.randomUUID()}`;
    const onlineMarker = `online-edit-${crypto.randomUUID()}`;

    // Explicitly disconnect the editor while retaining its local Y.Doc.
    const disconnected = waitForProviderEvent(
      editorClient.provider,
      "disconnect",
    );

    editorClient.provider.disconnect();
    await disconnected;

    expect(editorClient.provider.synced).toBe(false);

    // This edit remains local because the editor's WebSocket is closed.
    appendParagraph(editorClient.document, offlineMarker);

    await sleep(250);

    expect(
      extractXmlText(ownerClient.document.getXmlFragment(COLLABORATION_FIELD)),
    ).not.toContain(offlineMarker);

    // The owner continues editing while the other client is disconnected.
    appendParagraph(ownerClient.document, onlineMarker);

    await waitForPersistedText(fixture.documentId, onlineMarker);

    // Reconnect and wait for the provider's next completed sync handshake.
    const resynced = waitForProviderEvent(editorClient.provider, "synced");

    await Promise.all([editorClient.provider.connect(), resynced]);

    // Both the previously offline update and the server-side update
    // must reach the opposite client after reconnection.
    await waitForDocumentText(ownerClient.document, offlineMarker);
    await waitForDocumentText(editorClient.document, onlineMarker);

    const ownerText = extractXmlText(
      ownerClient.document.getXmlFragment(COLLABORATION_FIELD),
    );

    const editorText = extractXmlText(
      editorClient.document.getXmlFragment(COLLABORATION_FIELD),
    );

    expect(ownerText).toContain(offlineMarker);
    expect(ownerText).toContain(onlineMarker);
    expect(editorText).toContain(offlineMarker);
    expect(editorText).toContain(onlineMarker);

    // Both clients must now represent exactly the same shared document.
    expect(ownerText).toBe(editorText);

    // Both changes must be stored in the persisted binary Yjs state.
    await waitForPersistedText(fixture.documentId, offlineMarker);
    await waitForPersistedText(fixture.documentId, onlineMarker);

    const persistedText = await readPersistedText(fixture.documentId);

    expect(persistedText).toContain(offlineMarker);
    expect(persistedText).toContain(onlineMarker);
    expect(persistedText).toBe(ownerText);

    // Verify the acknowledgement hash against the JSON record in
    // PostgreSQL, not against a client-provided value.
    const persistedRecord = await prisma.document.findUnique({
      where: { id: fixture.documentId },
      select: { content: true },
    });

    if (!persistedRecord) {
      throw new Error("Persisted document was not found.");
    }

    const expectedHash = hashJsonContent(persistedRecord.content);

    const [ownerAcknowledgement, editorAcknowledgement] = await Promise.all([
      waitForPersistenceAcknowledgement(ownerClient, expectedHash),
      waitForPersistenceAcknowledgement(editorClient, expectedHash),
    ]);

    expect(ownerAcknowledgement.contentHash).toBe(expectedHash);
    expect(editorAcknowledgement.contentHash).toBe(expectedHash);
    expect(Number.isNaN(Date.parse(ownerAcknowledgement.savedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(editorAcknowledgement.savedAt))).toBe(false);
  } finally {
    if (editorClient) {
      disposeClient(editorClient);
    }

    if (ownerClient) {
      disposeClient(ownerClient);
    }
  }
}, 60_000);

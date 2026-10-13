import "dotenv/config";

import { startCollaborationServer } from "./collaboration-server";

// Render supplies PORT. Locally, COLLAB_PORT remains available for
// the existing development setup.
if (!process.env.COLLAB_PORT && process.env.PORT) {
  process.env.COLLAB_PORT = process.env.PORT;
}

try {
  await startCollaborationServer();
} catch (error) {
  console.error("Failed to start collaboration service:", error);
  process.exitCode = 1;
}
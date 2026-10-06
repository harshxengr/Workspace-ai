import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";

type NodeHeaders = Parameters<typeof fromNodeHeaders>[0];

export async function requireAuth(headers: NodeHeaders) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  return session;
}
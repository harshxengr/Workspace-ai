
import "dotenv/config";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { prisma } from "@workspace/db";
import { allowAiRequest } from "../lib/ai-rate-limit";

let userId: string | null = null;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `ai-rate-limit-${randomUUID()}@example.test`,
      name: "AI rate-limit integration test",
    },
    select: { id: true },
  });

  userId = user.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.user.delete({
      where: { id: userId },
    });
  }
});

test(
  "enforces the rolling request limit under concurrent traffic",
  async () => {
    if (!userId) {
      throw new Error("The rate-limit test user was not created");
    }

    const results = await Promise.all(
      Array.from({ length: 15 }, () => allowAiRequest(userId!)),
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.filter((allowed) => !allowed)).toHaveLength(5);

    const rows = await prisma.$queryRaw<
      Array<{ requestCount: number }>
    >`
      SELECT COUNT(*)::int AS "requestCount"
      FROM "ai_request_events"
      WHERE "user_id" = ${userId}
        AND "requested_at" > NOW() - INTERVAL '60 seconds'
    `;

    expect(Number(rows[0]?.requestCount ?? 0)).toBe(10);
  },
  30_000,
);

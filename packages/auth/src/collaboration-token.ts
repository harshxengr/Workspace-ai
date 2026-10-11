
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "workspace-ai";
const AUDIENCE = "workspace-ai-collaboration";

export type CollaborationTokenClaims = {
    userId: string;
    documentId: string;
    name: string;
    color: string;
};

function getSigningKey(): Uint8Array {
    const secret = process.env.BETTER_AUTH_SECRET;

    if (!secret) {
        throw new Error("BETTER_AUTH_SECRET is not configured");
    }

    return new TextEncoder().encode(secret);
}

export function getCollaborationColor(userId: string): string {
    const colors = [
        "#2563eb",
        "#7c3aed",
        "#0891b2",
        "#16a34a",
        "#db2777",
        "#ea580c",
    ];

    let hash = 0;

    for (const character of userId) {
        hash = (hash * 31 + character.charCodeAt(0)) | 0;
    }

    return colors[(hash >>> 0) % colors.length] ?? "#2563eb";
}

export async function createCollaborationToken(
    claims: CollaborationTokenClaims,
): Promise<string> {
    return new SignJWT({
        documentId: claims.documentId,
        name: claims.name,
        color: claims.color,
    })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(claims.userId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(getSigningKey());
}

export async function verifyCollaborationToken(
    token: string,
): Promise<CollaborationTokenClaims> {
    const { payload } = await jwtVerify(
        token,
        getSigningKey(),
        {
            issuer: ISSUER,
            audience: AUDIENCE,
            algorithms: ["HS256"],
        },
    );

    if (
        typeof payload.sub !== "string" ||
        typeof payload.documentId !== "string" ||
        typeof payload.name !== "string" ||
        typeof payload.color !== "string"
    ) {
        throw new Error("Invalid collaboration token claims");
    }

    return {
        userId: payload.sub,
        documentId: payload.documentId,
        name: payload.name,
        color: payload.color,
    };
}

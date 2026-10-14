-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_tokenHash_key" ON "workspace_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "workspace_invitations_workspaceId_email_idx" ON "workspace_invitations"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "workspace_invitations_email_expiresAt_idx" ON "workspace_invitations"("email", "expiresAt");

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

type WorkspaceInvitationEmail = {
  to: string;
  from: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  invitationUrl: string;
  expiresAt: Date;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] ?? character;
  });
}

export async function sendWorkspaceInvitationEmail({
  to,
  from,
  workspaceName,
  inviterName,
  role,
  invitationUrl,
  expiresAt,
}: WorkspaceInvitationEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey || !from.trim()) {
    throw new Error("INVITATION_EMAIL_NOT_CONFIGURED");
  }

  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeInviterName = escapeHtml(inviterName);
  const safeRole = escapeHtml(role);
  const safeInvitationUrl = escapeHtml(invitationUrl);
  const formattedExpiry = expiresAt.toUTCString();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${inviterName} invited you to ${workspaceName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;line-height:1.6;color:#111827">
          <h1 style="font-size:24px">You're invited to WorkspaceAI</h1>
          <p><strong>${safeInviterName}</strong> invited you to join
          <strong>${safeWorkspaceName}</strong> as a <strong>${safeRole}</strong>.</p>
          <p>Collaborate on documents and work with your team in one workspace.</p>
          <p style="margin:28px 0">
            <a href="${safeInvitationUrl}"
              style="background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
              Accept invitation
            </a>
          </p>
          <p>This invitation expires on ${escapeHtml(formattedExpiry)}.</p>
          <p style="font-size:12px;color:#6b7280">
            If you weren't expecting this invitation, you can ignore this email.
          </p>
        </div>
      `,
      text: [
        `${inviterName} invited you to join ${workspaceName} on WorkspaceAI.`,
        `Role: ${role}`,
        "",
        `Accept the invitation: ${invitationUrl}`,
        "",
        `This invitation expires on ${formattedExpiry}.`,
        "If you weren't expecting this invitation, you can ignore this email.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    // Avoid logging the API response body, which may contain provider details.
    throw new Error(`INVITATION_EMAIL_DELIVERY_FAILED_${response.status}`);
  }
}

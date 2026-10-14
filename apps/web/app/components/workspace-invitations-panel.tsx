"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";

type InvitationRole = "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER";
type CurrentRole = "OWNER" | "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER" | null;

type WorkspaceInvitation = {
  id: string;
  email: string;
  role: InvitationRole;
  createdAt: string;
  expiresAt: string;
};

type InvitationListResponse = {
  invitations: WorkspaceInvitation[];
};

type CreateInvitationResponse = {
  invitation: WorkspaceInvitation;
  delivery: "email" | "preview";
  inviteUrl?: string;
};

const OWNER_ROLES: InvitationRole[] = ["ADMIN", "EDITOR", "MEMBER", "VIEWER"];

const ADMIN_ROLES: InvitationRole[] = ["EDITOR", "MEMBER", "VIEWER"];

type Props = {
  workspaceId: string;
  currentRole: CurrentRole;
};

export default function WorkspaceInvitationsPanel({
  workspaceId,
  currentRole,
}: Props) {
  const canManage = currentRole === "OWNER" || currentRole === "ADMIN";

  const availableRoles = currentRole === "OWNER" ? OWNER_ROLES : ADMIN_ROLES;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("MEMBER");
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const loadInvitations = useCallback(async () => {
    const result = await apiFetch<InvitationListResponse>(
      `/api/workspaces/${workspaceId}/invitations`,
    );

    setInvitations(result.invitations);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!canManage) {
        setInvitations([]);
        setLoading(false);
        return;
      }

      try {
        const result = await apiFetch<InvitationListResponse>(
          `/api/workspaces/${workspaceId}/invitations`,
        );

        if (!cancelled) {
          setInvitations(result.invitations);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load invitations",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, canManage]);

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage) return;

    const normalizedEmail = email.trim().toLowerCase();

    setSending(true);
    setError("");
    setSuccess("");
    setPreviewUrl("");

    try {
      const result = await apiFetch<CreateInvitationResponse>(
        `/api/workspaces/${workspaceId}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            email: normalizedEmail,
            role,
          }),
        },
      );

      setEmail("");

      if (result.delivery === "preview" && result.inviteUrl) {
        setSuccess(
          "Invitation created in development preview mode. Copy the link below to test acceptance.",
        );
        setPreviewUrl(result.inviteUrl);
      } else {
        setSuccess(`Invitation email sent to ${normalizedEmail}.`);
      }

      try {
        await loadInvitations();
      } catch {
        // Keep the successful send result visible even if refreshing fails.
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send invitation",
      );
    } finally {
      setSending(false);
    }
  }

  async function revokeInvitation(invitation: WorkspaceInvitation) {
    const confirmed = window.confirm(
      `Revoke the invitation sent to ${invitation.email}?`,
    );

    if (!confirmed) return;

    setRevokingId(invitation.id);
    setError("");
    setSuccess("");
    setPreviewUrl("");

    try {
      await apiFetch(
        `/api/workspaces/${workspaceId}/invitations/${invitation.id}`,
        {
          method: "DELETE",
        },
      );

      setInvitations((current) =>
        current.filter((item) => item.id !== invitation.id),
      );
      setSuccess(`Invitation for ${invitation.email} was revoked.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke invitation",
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError("");

    try {
      await loadInvitations();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh invitations",
      );
    } finally {
      setRefreshing(false);
    }
  }

  if (!canManage) {
    return null;
  }

  return (
    <section className="mt-8 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">Email invitations</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite teammates even if they haven&apos;t created an account yet.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || loading}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <form
        onSubmit={sendInvitation}
        className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto]"
      >
        <div>
          <label
            htmlFor="invitation-email"
            className="mb-1.5 block text-sm font-medium"
          >
            Teammate&apos;s email
          </label>

          <input
            id="invitation-email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError("");
              setSuccess("");
              setPreviewUrl("");
            }}
            placeholder="teammate@example.com"
            disabled={sending}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="invitation-role"
            className="mb-1.5 block text-sm font-medium"
          >
            Role
          </label>

          <select
            id="invitation-role"
            value={role}
            onChange={(event) => setRole(event.target.value as InvitationRole)}
            disabled={sending}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          >
            {availableRoles.map((availableRole) => (
              <option key={availableRole} value={availableRole}>
                {availableRole}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 md:w-auto"
          >
            {sending ? "Sending..." : "Send invitation"}
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-300 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="mt-4 rounded-md border border-green-300 p-3 text-sm text-green-800"
        >
          {success}
        </div>
      )}

      {previewUrl && (
        <div className="mt-3 rounded-md border p-3">
          <p className="text-sm font-medium">Development invitation link</p>
          <a
            href={previewUrl}
            className="mt-2 block break-all text-sm underline"
          >
            {previewUrl}
          </a>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(previewUrl).then(
                () => setSuccess("Invitation link copied."),
                () => setError("Could not copy the invitation link."),
              );
            }}
            className="mt-3 rounded-md border px-3 py-1.5 text-sm"
          >
            Copy link
          </button>
        </div>
      )}

      <div className="mt-8 border-t pt-5">
        <h4 className="font-semibold">
          Pending invitations ({invitations.length})
        </h4>

        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Loading invitations...
          </p>
        ) : invitations.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No pending invitations.
          </p>
        ) : (
          <div className="mt-3 divide-y rounded-lg border">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="break-all font-medium">{invitation.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {invitation.role} · Expires{" "}
                    {new Date(invitation.expiresAt).toLocaleString()}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void revokeInvitation(invitation)}
                  disabled={revokingId === invitation.id}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {revokingId === invitation.id ? "Revoking..." : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import WorkspaceInvitationsPanel from "../../components/workspace-invitations-panel";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

type Document = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type MemberRole = "OWNER" | "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER";
type AssignableRole = Exclude<MemberRole, "OWNER">;

type WorkspaceMember = {
  id: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
};

type MembersResponse = {
  members: WorkspaceMember[];
};

const ASSIGNABLE_ROLES: AssignableRole[] = [
  "ADMIN",
  "EDITOR",
  "MEMBER",
  "VIEWER",
];

const MEMBER_ROLES: AssignableRole[] = ["EDITOR", "MEMBER", "VIEWER"];

export default function WorkspacePage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<
    Record<string, MemberRole>
  >({});

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingTitleId, setSavingTitleId] = useState<string | null>(null);

  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<AssignableRole>("MEMBER");
  const [addingMember, setAddingMember] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [memberError, setMemberError] = useState("");
  const [memberSuccess, setMemberSuccess] = useState("");
  const [refreshingMembers, setRefreshingMembers] = useState(false);

  const [error, setError] = useState("");

  async function refreshMembers(workspaceId: string) {
    const result = await apiFetch<MembersResponse>(
      `/api/workspaces/${workspaceId}/members`,
    );

    setMembers(result.members);
    setSelectedRoles(
      Object.fromEntries(
        result.members.map((member) => [member.id, member.role]),
      ) as Record<string, MemberRole>,
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      try {
        setLoading(true);
        setError("");

        const workspaceResult = await apiFetch<{
          workspaces: Workspace[];
        }>("/api/workspaces");

        const foundWorkspace = workspaceResult.workspaces.find(
          (item) => item.slug === slug,
        );

        if (!foundWorkspace) {
          throw new Error("Workspace not found");
        }

        const [documentResult, membersResult, currentUserResult] =
          await Promise.all([
            apiFetch<{ documents: Document[] }>(
              `/api/workspaces/${foundWorkspace.id}/documents`,
            ),
            apiFetch<MembersResponse>(
              `/api/workspaces/${foundWorkspace.id}/members`,
            ),
            apiFetch<{
              user: { id: string };
            }>("/api/me"),
          ]);

        if (cancelled) return;

        setWorkspace(foundWorkspace);
        setDocuments(documentResult.documents);
        setMembers(membersResult.members);
        setCurrentUserId(currentUserResult.user.id);
        setSelectedRoles(
          Object.fromEntries(
            membersResult.members.map((member) => [member.id, member.role]),
          ) as Record<string, MemberRole>,
        );
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load workspace",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const currentMembership = members.find(
    (member) => member.userId === currentUserId,
  );

  const currentRole = currentMembership?.role ?? null;
  const canAddMembers = currentRole === "OWNER" || currentRole === "ADMIN";
  const canManageMembers = currentRole === "OWNER";

  async function createDocument() {
    if (!workspace) return;

    try {
      setCreating(true);
      setError("");

      const result = await apiFetch<{ document: Document }>(
        `/api/workspaces/${workspace.id}/documents`,
        {
          method: "POST",
          body: JSON.stringify({
            title: "Untitled document",
          }),
        },
      );

      setDocuments((current) => [result.document, ...current]);

      router.push(
        `/workspaces/${workspace.slug}/documents/${result.document.id}`,
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to create document",
      );
    } finally {
      setCreating(false);
    }
  }

  function startRename(document: Document) {
    setEditingId(document.id);
    setEditingTitle(document.title);
    setError("");
  }

  function cancelRename() {
    setEditingId(null);
    setEditingTitle("");
  }

  async function saveRename(documentId: string) {
    const nextTitle = editingTitle.trim();

    if (!nextTitle) {
      setError("Document title cannot be empty");
      return;
    }

    try {
      setSavingTitleId(documentId);
      setError("");

      const result = await apiFetch<{ document: Document }>(
        `/api/documents/${documentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: nextTitle }),
        },
      );

      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId ? result.document : document,
        ),
      );

      cancelRename();
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to rename document",
      );
    } finally {
      setSavingTitleId(null);
    }
  }

  async function deleteDocument(documentId: string) {
    if (!workspace) return;

    const document = documents.find((item) => item.id === documentId);
    if (!document) return;

    const confirmed = window.confirm(
      `Delete "${document.title}"?\n\nThis action cannot be undone.`,
    );

    if (!confirmed) return;

    try {
      setDeletingId(documentId);
      setError("");

      await apiFetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });

      setDocuments((current) =>
        current.filter((item) => item.id !== documentId),
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to delete document",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspace || !canAddMembers) return;

    const email = memberEmail.trim().toLowerCase();

    setAddingMember(true);
    setMemberError("");
    setMemberSuccess("");

    try {
      await apiFetch<{ member: { id: string } }>(
        `/api/workspaces/${workspace.id}/members`,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            role: memberRole,
          }),
        },
      );

      await refreshMembers(workspace.id);
      setMemberEmail("");
      setMemberSuccess(`${email} was added to the workspace.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add member";

      if (message === "User not found") {
        setMemberError(
          "No account exists for this email yet. Ask the person to sign up for WorkspaceAI first, then add them here.",
        );
      } else if (message === "User is already a workspace member") {
        setMemberError("This person is already a member of this workspace.");
      } else {
        setMemberError(message);
      }
    } finally {
      setAddingMember(false);
    }
  }

  async function saveMemberRole(member: WorkspaceMember) {
    if (!workspace || !canManageMembers || member.role === "OWNER") return;

    const nextRole = selectedRoles[member.id];

    if (!nextRole || nextRole === member.role) return;

    setSavingMemberId(member.id);
    setMemberError("");
    setMemberSuccess("");

    try {
      await apiFetch<{ member: WorkspaceMember }>(
        `/api/workspaces/${workspace.id}/members/${member.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role: nextRole }),
        },
      );

      await refreshMembers(workspace.id);
      setMemberSuccess(`Updated ${member.user.email}'s role to ${nextRole}.`);
    } catch (err) {
      setMemberError(
        err instanceof Error ? err.message : "Failed to update member role",
      );
    } finally {
      setSavingMemberId(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!workspace || !canManageMembers || member.role === "OWNER") return;

    const confirmed = window.confirm(
      `Remove ${member.user.email} from ${workspace.name}?`,
    );

    if (!confirmed) return;

    setRemovingMemberId(member.id);
    setMemberError("");
    setMemberSuccess("");

    try {
      await apiFetch(`/api/workspaces/${workspace.id}/members/${member.id}`, {
        method: "DELETE",
      });

      await refreshMembers(workspace.id);
      setMemberSuccess(`${member.user.email} was removed from the workspace.`);
    } catch (err) {
      setMemberError(
        err instanceof Error ? err.message : "Failed to remove member",
      );
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function handleRefreshMembers() {
    if (!workspace) return;

    setRefreshingMembers(true);
    setMemberError("");

    try {
      await refreshMembers(workspace.id);
    } catch (err) {
      setMemberError(
        err instanceof Error ? err.message : "Failed to refresh members",
      );
    } finally {
      setRefreshingMembers(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen p-8">Loading workspace...</main>;
  }

  if (error && !workspace) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-bold">Workspace error</h1>
        <p className="mt-2">{error}</p>
        <Link href="/dashboard" className="mt-4 inline-block underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  if (!workspace) {
    return <main className="min-h-screen p-8">Workspace not found.</main>;
  }

  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full border-b p-4 md:w-80 md:border-r md:border-b-0">
        <div className="mb-6">
          <Link href="/dashboard" className="text-sm underline">
            ← Dashboard
          </Link>

          <h1 className="mt-4 text-xl font-bold">{workspace.name}</h1>

          {workspace.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {workspace.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Documents</h2>

          <button
            type="button"
            onClick={() => void createDocument()}
            disabled={creating}
            className="rounded border px-2 py-1 text-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "+ New"}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {documents.map((document) => {
            const isEditing = editingId === document.id;
            const isSaving = savingTitleId === document.id;
            const isDeleting = deletingId === document.id;

            return (
              <div key={document.id} className="rounded border p-2">
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveRename(document.id);
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                      disabled={isSaving}
                      className="w-full rounded border px-2 py-1 text-sm outline-none"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveRename(document.id)}
                        disabled={isSaving}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </button>

                      <button
                        type="button"
                        onClick={cancelRename}
                        disabled={isSaving}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/workspaces/${workspace.slug}/documents/${document.id}`}
                      className="min-w-0 flex-1 truncate"
                    >
                      {document.title}
                    </Link>

                    <button
                      type="button"
                      onClick={() => startRename(document)}
                      className="text-xs"
                      title="Rename document"
                    >
                      Rename
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteDocument(document.id)}
                      disabled={isDeleting}
                      className="text-sm"
                      title="Delete document"
                    >
                      {isDeleting ? "..." : "×"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {documents.length === 0 && (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded border p-3 text-sm">
            {error}
          </div>
        )}
      </aside>

      <section className="min-w-0 flex-1 p-5 md:p-8">
        <div className="border-b pb-6">
          <h2 className="text-3xl font-bold">{workspace.name}</h2>
          <p className="mt-2 text-muted-foreground">
            Manage your documents and collaborate with your team.
          </p>
        </div>

        {documents.length > 0 && (
          <section className="mt-8">
            <h3 className="text-xl font-semibold">Recent documents</h3>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {documents.map((document) => (
                <Link
                  key={document.id}
                  href={`/workspaces/${workspace.slug}/documents/${document.id}`}
                  className="block rounded-lg border p-4 transition hover:bg-muted/40"
                >
                  <div className="font-medium">{document.title}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Updated {new Date(document.updatedAt).toLocaleString()}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">
                Members{" "}
                <span className="text-muted-foreground">
                  ({members.length})
                </span>
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                See who has access to this workspace.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleRefreshMembers()}
              disabled={refreshingMembers}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              {refreshingMembers ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
            <div className="rounded-xl border">
              {members.map((member) => {
                const selectedRole = selectedRoles[member.id] ?? member.role;
                const isOwner = member.role === "OWNER";
                const isSaving = savingMemberId === member.id;
                const isRemoving = removingMemberId === member.id;
                const roleChanged = selectedRole !== member.role;

                return (
                  <div key={member.id} className="border-b p-4 last:border-b-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">
                          {(member.user.name || member.user.email)
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {member.user.name || "Workspace member"}
                            {member.userId === currentUserId ? " (you)" : ""}
                          </p>
                          <p className="break-all text-sm text-muted-foreground">
                            {member.user.email}
                          </p>
                        </div>
                      </div>

                      <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                        {member.role}
                      </span>
                    </div>

                    {canManageMembers && !isOwner && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`member-role-${member.id}`}
                          className="text-sm text-muted-foreground"
                        >
                          Role
                        </label>

                        <select
                          id={`member-role-${member.id}`}
                          value={selectedRole}
                          disabled={isSaving || isRemoving}
                          onChange={(event) =>
                            setSelectedRoles((current) => ({
                              ...current,
                              [member.id]: event.target.value as MemberRole,
                            }))
                          }
                          className="rounded-md border bg-background px-2 py-1.5 text-sm"
                        >
                          {ASSIGNABLE_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => void saveMemberRole(member)}
                          disabled={!roleChanged || isSaving || isRemoving}
                          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
                        >
                          {isSaving ? "Saving..." : "Save role"}
                        </button>

                        <button
                          type="button"
                          onClick={() => void removeMember(member)}
                          disabled={isSaving || isRemoving}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40"
                        >
                          {isRemoving ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {members.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  No members were returned for this workspace.
                </p>
              )}
            </div>

            <div className="h-fit rounded-xl border p-5">
              <h4 className="text-lg font-semibold">Add a member</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Add someone who already has a WorkspaceAI account.
              </p>

              {canAddMembers ? (
                <form onSubmit={addMember} className="mt-4 space-y-4">
                  <div>
                    <label
                      htmlFor="member-email"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      Account email
                    </label>
                    <input
                      id="member-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={memberEmail}
                      onChange={(event) => {
                        setMemberEmail(event.target.value);
                        setMemberError("");
                        setMemberSuccess("");
                      }}
                      placeholder="teammate@example.com"
                      disabled={addingMember}
                      className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="member-role"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      Workspace role
                    </label>
                    <select
                      id="member-role"
                      value={memberRole}
                      onChange={(event) =>
                        setMemberRole(event.target.value as AssignableRole)
                      }
                      disabled={addingMember}
                      className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
                    >
                      {(currentRole === "OWNER"
                        ? ASSIGNABLE_ROLES
                        : MEMBER_ROLES
                      ).map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {currentRole === "OWNER"
                        ? "Owners can assign any non-owner role."
                        : "Admins can add editors, members, and viewers."}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={addingMember || !memberEmail.trim()}
                    className="w-full rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {addingMember ? "Adding member..." : "Add member"}
                  </button>
                </form>
              ) : (
                <p className="mt-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  Only workspace owners and admins can add members.
                </p>
              )}

              <p className="mt-4 text-xs text-muted-foreground">
                The person must sign up before you can add their account.
                Sending invitation emails is not implemented yet.
              </p>

              {memberError && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-red-300 p-3 text-sm text-red-700"
                >
                  {memberError}
                </div>
              )}

              {memberSuccess && (
                <div
                  role="status"
                  className="mt-4 rounded-md border border-green-300 p-3 text-sm text-green-800"
                >
                  {memberSuccess}
                </div>
              )}
            </div>
          </div>
        </section>

        <WorkspaceInvitationsPanel
          workspaceId={workspace.id}
          currentRole={currentRole}
        />
      </section>
    </main>
  );
}

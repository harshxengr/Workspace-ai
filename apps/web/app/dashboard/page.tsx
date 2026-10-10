"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";
import { apiFetch } from "../lib/api";
import Link from "next/link";

type Workspace = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
};

export default function DashboardPage() {
    const router = useRouter();

    const [user, setUser] = useState<{
        name: string;
        email: string;
    } | null>(null);

    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [loading, setLoading] = useState(true);

    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        async function loadDashboard() {
            const { data } = await authClient.getSession();

            if (!data?.user) {
                router.replace("/login");
                return;
            }

            setUser(data.user);

            try {
                const result = await apiFetch<{ workspaces: Workspace[] }>(
                    "/api/workspaces",
                );

                setWorkspaces(result.workspaces);
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        }

        loadDashboard();
    }, [router]);

    async function createWorkspace() {
        setCreating(true);

        try {
            const result = await apiFetch<{ workspace: Workspace }>(
                "/api/workspaces",
                {
                    method: "POST",
                    body: JSON.stringify({
                        name,
                        description,
                    }),
                },
            );

            setWorkspaces((current) => [result.workspace, ...current]);
            setName("");
            setDescription("");
            setShowCreate(false);
        } catch (error) {
            console.error(error);
        } finally {
            setCreating(false);
        }
    }

    if (loading || !user) {
        return (
            <main className="flex min-h-screen items-center justify-center">
                Loading...
            </main>
        );
    }

    return (
        <main className="min-h-screen p-8">
            <h1 className="text-3xl font-bold">
                Welcome, {user.name}
            </h1>

            <p className="mt-1 text-muted-foreground">{user.email}</p>

            <section className="mt-8">
                <h2 className="text-xl font-semibold">Your workspaces</h2>

                <div className="mt-4 space-y-3">
                    {workspaces.map((workspace) => (
                        <Link
                            key={workspace.id}
                            href={`/workspaces/${workspace.slug}`}
                            className="block rounded-xl border p-4 transition hover:bg-muted"
                        >
                            <h3 className="font-semibold">{workspace.name}</h3>

                            <p className="text-sm text-muted-foreground">
                                {workspace.description || "No description"}
                            </p>
                        </Link>
                    ))}

                    {workspaces.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            You do not have any workspaces yet.
                        </p>
                    )}

                    <button
                        onClick={() => setShowCreate(true)}
                        className="rounded-md bg-black px-4 py-2 text-white"
                    >
                        Create workspace
                    </button>

                    {showCreate && (
                        <div className="mt-4 rounded-xl border p-4">
                            <input
                                className="w-full rounded-md border p-2"
                                placeholder="Workspace name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />

                            <textarea
                                className="mt-3 w-full rounded-md border p-2"
                                placeholder="Description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />

                            <button
                                onClick={createWorkspace}
                                disabled={creating || !name.trim()}
                                className="mt-3 rounded-md bg-black px-4 py-2 text-white"
                            >
                                {creating ? "Creating..." : "Create"}
                            </button>
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}
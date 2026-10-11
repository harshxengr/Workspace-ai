export type WorkspaceRole =
    | "OWNER"
    | "ADMIN"
    | "EDITOR"
    | "MEMBER"
    | "VIEWER";

export function canCreateDocument(role: WorkspaceRole): boolean {
    return role !== "VIEWER";
}

export function canEditDocument(role: WorkspaceRole): boolean {
    return (
        role === "OWNER" ||
        role === "ADMIN" ||
        role === "EDITOR"
    );
}

export function canDeleteDocument(role: WorkspaceRole): boolean {
    return role === "OWNER" || role === "ADMIN";
}

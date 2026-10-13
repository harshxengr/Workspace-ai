# WorkspaceAI

WorkspaceAI is a collaborative workspace and document editor built with Next.js, Bun, Express, PostgreSQL, Prisma, Tiptap, Yjs, and Hocuspocus.

It provides a foundation for teams to organize documents, collaborate in real time, manage workspace access, and restore earlier document versions.

## Features

- **Authentication:** Email and password registration and sign-in using Better Auth.
- **Workspaces:** Create and organize workspaces, with workspace membership.
- **Role-based access control:** Support for OWNER, ADMIN, EDITOR, MEMBER, and VIEWER roles.
- **Document management:** Create, list, rename, retrieve, update, and delete documents, subject to permissions.
- **Rich-text editing:** Edit documents with Tiptap and its formatting extensions.
- **Real-time collaboration:** Synchronize document changes through Yjs and Hocuspocus.
- **Collaborator awareness:** Display live collaborator cursors and identity colors.
- **Document persistence:** Store Tiptap JSON and binary Yjs state in PostgreSQL.
- **Save feedback:** Display save status based on persistence confirmations and content comparison.
- **Version history:** Create manual snapshots and restore an earlier version.
- **Automated testing:** Unit and integration tests for permissions, collaboration, reconnect recovery, persistence, and restoration.
- **Continuous integration:** GitHub Actions runs database migrations, tests, type checks, linting, and builds.

## Technology stack

| Area                         | Technology                 |
| ---------------------------- | -------------------------- |
| Frontend                     | Next.js, React, TypeScript |
| Styling                      | Tailwind CSS               |
| Rich-text editor             | Tiptap                     |
| Collaborative document model | Yjs                        |
| Collaboration server         | Hocuspocus                 |
| Backend API                  | Bun, Express               |
| Authentication               | Better Auth                |
| Database                     | PostgreSQL                 |
| ORM and migrations           | Prisma                     |
| Validation                   | Zod                        |
| Monorepo                     | Bun workspaces, Turborepo  |
| CI                           | GitHub Actions             |

## Architecture

```text
Browser
  |
  | HTTP / REST
  v
Next.js Web Application (:3000)
  |
  | Authenticated API requests
  v
Bun + Express API (:4000)
  |
  +---- Better Auth
  |
  +---- Workspace, membership, and document routes
  |
  +---- Collaboration token endpoint
  |
  +---- Hocuspocus WebSocket server (:1234)
              |
              +---- Yjs document synchronization
              |
              +---- PostgreSQL persistence

PostgreSQL
  |
  +---- Users and sessions
  +---- Workspaces and memberships
  +---- Documents and binary collaboration state
  +---- Document version snapshots
```

The web application makes HTTP requests to the API and connects to the collaboration server over WebSockets.

The API authenticates users and checks workspace membership and permissions. Collaboration connections use short-lived, document-specific tokens. The collaboration server synchronizes Yjs changes and persists document content and binary collaboration state.

### Repository structure

```text
Workspace-ai/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── routes/
│   │       ├── lib/
│   │       ├── integration/
│   │       ├── collaboration-server.ts
│   │       └── index.ts
│   └── web/
│       └── app/
│           ├── components/
│           ├── dashboard/
│           ├── login/
│           ├── signup/
│           ├── workspaces/
│           └── lib/
├── packages/
│   ├── auth/
│   ├── db/
│   │   └── prisma/
│   ├── eslint-config/
│   ├── typescript-config/
│   └── ui/
├── .github/
│   └── workflows/
│       └── ci.yml
├── package.json
├── bun.lock
└── turbo.json
```

## Prerequisites

Install the following tools before starting development:

- [Bun](https://bun.sh/) — use version `1.3.4`, matching the CI configuration.
- [Node.js](https://nodejs.org/) — version 24 or newer, matching the repository's declared engine.
- [PostgreSQL](https://www.postgresql.org/) — a running database.
- [Docker](https://www.docker.com/) — optional, if you prefer to run PostgreSQL in a container.

## Local development setup

### 1. Clone the repository

```bash
git clone https://github.com/harshxengr/Workspace-ai.git
cd Workspace-ai
```

### 2. Install dependencies

```bash
bun install
```

### 3. Start PostgreSQL

If you already have a PostgreSQL server and database available, use those and skip this step.

Otherwise, start a local PostgreSQL 16 container:

```bash
docker run \
  --name workspace-ai-postgres \
  --restart unless-stopped \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=workspace_ai \
  -p 5432:5432 \
  -v workspace-ai-postgres-data:/var/lib/postgresql/data \
  -d postgres:16
```

This creates a development database named `workspace_ai`. The example credentials are for local development only; use secure credentials for any deployed environment.

### 4. Configure the API environment

Copy the API environment example:

```bash
cp apps/api/.env.example apps/api/.env
```

Set the values in `apps/api/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workspace_ai?schema=public"
BETTER_AUTH_URL="http://localhost:4000"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
PORT=4000
COLLAB_PORT=1234
```

Generate a random secret with:

```bash
openssl rand -base64 32
```

Use the generated value for `BETTER_AUTH_SECRET`.

### 5. Configure the database environment

Prisma commands run from the database package, so place the database connection settings where the Prisma configuration can load them:

```bash
cp apps/api/.env packages/db/.env
```

The `DATABASE_URL` in both files must point to the same PostgreSQL database.

### 6. Configure the web application

Create `apps/web/.env.local` with the following local development settings:

```dotenv
NEXT_PUBLIC_API_URL="http://localhost:4000"
NEXT_PUBLIC_COLLAB_URL="ws://localhost:1234"
```

These values tell the frontend where to send API requests and where to connect for real-time collaboration.

### 7. Generate the Prisma client and apply migrations

From the repository root, run:

```bash
bun --cwd packages/db generate
bun --cwd packages/db run migrate:deploy
```

The first command generates the Prisma client. The second applies the existing database migrations.

For local schema development that requires creating a new migration, use:

```bash
bun --cwd packages/db run migrate
```

Review generated migrations before committing them.

### 8. Start the application

Start the web app and API through Turborepo:

```bash
bun run dev
```

The expected local endpoints are:

| Service                 | URL                             |
| ----------------------- | ------------------------------- |
| Web application         | http://localhost:3000           |
| REST API                | http://localhost:4000           |
| Collaboration WebSocket | ws://localhost:1234             |
| API health check        | http://localhost:4000/health    |
| Database health check   | http://localhost:4000/health/db |

The API process also starts the collaboration server.

Open the web application, create an account, sign in, and create a workspace to begin testing the application.

## Workspace roles and permissions

WorkspaceAI defines these roles:

| Role   | Intended access                                        |
| ------ | ------------------------------------------------------ |
| OWNER  | Workspace ownership and administrative access          |
| ADMIN  | Administrative workspace access                        |
| EDITOR | Create and edit documents                              |
| MEMBER | Workspace membership without document-edit permissions |
| VIEWER | Read-only document access                              |

Document creation, editing, deletion, membership management, and version restoration are enforced by backend permission checks. Refer to `apps/api/src/lib/document-permissions.ts` for the actual permission rules.

## How collaboration works

The collaborative editor uses Tiptap for rich-text editing and Yjs for shared document state. Hocuspocus transports collaboration updates between connected clients.

The collaboration flow is:

1. The authenticated web application requests a document-specific collaboration token.
2. The API checks the user's access to the document's workspace.
3. The client connects to Hocuspocus using the document ID and token.
4. Yjs synchronizes changes between authorized clients.
5. The collaboration server persists the document's Tiptap JSON and binary Yjs state in PostgreSQL.
6. The frontend uses save acknowledgements to help determine whether the current content matches a persisted snapshot.

Manual version snapshots are separate from the live collaboration state. The version history feature can restore a saved snapshot through the active collaborative document.

## API overview

The REST API is served by Express at the configured API URL.

### Health and authentication

| Method | Endpoint      | Purpose                              |
| ------ | ------------- | ------------------------------------ |
| GET    | `/health`     | Check API availability               |
| GET    | `/health/db`  | Check database connectivity          |
| GET    | `/api/me`     | Retrieve the authenticated user      |
| `/`    | `/api/auth/*` | Better Auth authentication endpoints |

### Workspaces and members

| Method | Endpoint                               | Purpose                            |
| ------ | -------------------------------------- | ---------------------------------- |
| POST   | `/api/workspaces`                      | Create a workspace                 |
| GET    | `/api/workspaces`                      | List the current user's workspaces |
| POST   | `/api/workspaces/:workspaceId/members` | Add a workspace member             |
| GET    | `/api/workspaces/:workspaceId/members` | List workspace members             |

### Documents and collaboration

| Method | Endpoint                                                 | Purpose                                             |
| ------ | -------------------------------------------------------- | --------------------------------------------------- |
| POST   | `/api/workspaces/:workspaceId/documents`                 | Create a document                                   |
| GET    | `/api/workspaces/:workspaceId/documents`                 | List workspace documents                            |
| GET    | `/api/documents/:documentId`                             | Retrieve a document                                 |
| PATCH  | `/api/documents/:documentId`                             | Update document fields or create a version snapshot |
| DELETE | `/api/documents/:documentId`                             | Delete a document                                   |
| GET    | `/api/documents/:documentId/versions`                    | List document versions                              |
| POST   | `/api/documents/:documentId/versions/:versionId/restore` | Restore a document version                          |
| GET    | `/api/collaboration/documents/:documentId/token`         | Request a collaboration token                       |

Authenticated routes require a valid user session. Workspace membership and role permissions are checked by the relevant API handlers.

## Testing and code quality

Run the API unit tests:

```bash
bun --cwd apps/api test
```

Run the collaboration integration tests:

```bash
bun --cwd apps/api run test:integration
```

The integration tests require a reachable test PostgreSQL database and the required environment variables. They exercise real collaboration-server behavior and database persistence.

Run repository-wide checks:

```bash
bun run check-types
bun run lint
bun run build
```

The CI workflow in `.github/workflows/ci.yml` provisions PostgreSQL, installs dependencies, generates Prisma client code, applies migrations, and executes the test, type-check, lint, and build steps.

## Environment variable reference

| Variable                 | Used by                                 | Purpose                                                        |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`           | API and database package                | PostgreSQL connection string                                   |
| `BETTER_AUTH_URL`        | API authentication                      | Base URL for Better Auth                                       |
| `BETTER_AUTH_SECRET`     | Authentication and collaboration tokens | Signing secret                                                 |
| `PORT`                   | API                                     | HTTP port; defaults to `4000`                                  |
| `COLLAB_PORT`            | Collaboration server                    | WebSocket port; defaults to `1234`                             |
| `NEXT_PUBLIC_API_URL`    | Web application                         | API base URL; defaults to `http://localhost:4000`              |
| `NEXT_PUBLIC_COLLAB_URL` | Web application                         | Collaboration WebSocket URL; defaults to `ws://localhost:1234` |

Never commit local environment files, credentials, session tokens, or production secrets. Variables prefixed with `NEXT_PUBLIC_` are exposed to browser code and must not contain secrets.

## Deployment and security considerations

The repository currently provides a development setup and CI validation workflow; these do not, by themselves, constitute a complete production deployment configuration.

Before deploying publicly:

- Configure secure production PostgreSQL credentials and run migrations as part of release operations.
- Configure the correct production API URL, web origin, and collaboration WebSocket URL.
- Update the API's CORS configuration and Better Auth trusted origins for the intended deployment domains.
- Review the current Better Auth origin-check configuration and enable appropriate production protections.
- Use HTTPS and secure WebSocket transport (`wss://`) in production.
- Keep secrets in the deployment platform's secret manager, not in source control or public frontend variables.
- Configure database backups, monitoring, error reporting, and recovery procedures.
- Test authentication, workspace authorization, document permissions, collaborative persistence, reconnection, and version restoration in the deployed environment.

## Contributing

1. Create a feature branch from `main`.
2. Make a focused change and add or update tests where appropriate.
3. Run the relevant tests, type checks, lint, and build.
4. Open a pull request targeting `main`.
5. Review the CI results before merging.

## License

No license has been specified in this repository yet. Until one is added, do not assume the code is available for unrestricted reuse.

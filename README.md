# Workspace AI

**An AI-powered collaborative workspace for teams to organize documents, collaborate, and find information using natural language.**

Workspace AI combines workspace management, collaborative document editing, and AI-powered knowledge retrieval in one application. Team members can work together on documents and use the Knowledge Assistant to ask questions about indexed workspace content.

## Features

### Workspace Management
- Create and manage workspaces.
- Organize team members within workspaces.
- Support role-based access control.
- Manage workspace membership and permissions.

### Collaborative Documents
- Create and manage workspace documents.
- Edit documents in a collaborative environment.
- Keep document access scoped to the appropriate workspace.
- Organize knowledge around shared documents.

### AI Knowledge Assistant
- Ask natural-language questions about indexed workspace documents.
- Split document content into smaller chunks for retrieval.
- Generate embeddings using Google's Gemini embedding model.
- Store document embeddings in PostgreSQL with pgvector.
- Retrieve relevant document chunks to support answers.
- Manage document indexing through a dedicated interface.
- Process indexing jobs and track their status.

### AI Request Protection
- Apply AI request rate limiting.
- Track request events for rate-limit enforcement.
- Protect AI endpoints against excessive requests.

## Tech Stack

| Category | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS, shadcn/ui |
| Backend | TypeScript, Bun |
| Database | PostgreSQL |
| ORM | Prisma |
| Vector Search | pgvector |
| AI Embeddings | Gemini API |
| Authentication | Better Auth |
| Package Management | Bun |

The stack reflects the technologies used in the project. Individual integrations and configuration requirements may vary by environment.

## Architecture Overview

At a high level, the application follows this workflow:

1. Users authenticate and access their workspace.
2. Workspace members create or update documents.
3. Documents are submitted for indexing.
4. The indexing process extracts document text and splits it into chunks.
5. Gemini generates embeddings for the chunks.
6. The embeddings and associated content are stored in PostgreSQL using pgvector.
7. When a user asks a question, the application retrieves relevant indexed content.
8. The retrieved context is used to support the AI response.

```text
User
 |
 v
Next.js Web Application
 |
 v
Backend API
 |
 +---- Authentication and Permissions
 |
 +---- Workspace and Document Management
 |
 +---- Knowledge Assistant
          |
          +---- Document Chunking
          |
          +---- Gemini Embeddings
          |
          +---- PostgreSQL + pgvector
          |
          +---- Relevant Context Retrieval
          |
          v
       AI Response
```

## Getting Started

### Prerequisites

Install or configure the following:

- Git
- Bun (use the version specified by the repository)
- PostgreSQL with pgvector support
- A Google Gemini API key
- Node.js if required by your installed tools or deployment environment

You will also need access to a PostgreSQL database for local development.

### 1. Clone the Repository

```bash
git clone https://github.com/harshxengr/Workspace-ai.git
cd Workspace-ai
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment Variables

Create the environment files required by the applications and packages in the repository.

Example variables may include:

```env
DATABASE_URL="your-postgresql-connection-string"
GEMINI_API_KEY="your-gemini-api-key"
```

Configure any additional authentication, application URL, and service variables required by your existing code.

**Important:** Environment variable names must match the names referenced by your implementation. Check the existing environment examples and configuration files before adding or renaming variables. Never commit real API keys, database credentials, or secrets.

### 4. Configure the Database

Ensure your PostgreSQL database supports pgvector.

Apply the Prisma migrations using the database package and commands configured in the repository. For example, if the root scripts expose the relevant Prisma commands:

```bash
bun run db:generate
bun run db:migrate
```

These are illustrative commands; use the actual scripts defined in your `package.json` files. For a deployed database, follow your project's production migration workflow rather than running development migrations blindly.

### 5. Start the Application

Use the root development script if your repository defines one:

```bash
bun run dev
```

If the monorepo requires separate frontend and backend processes, start them using the scripts defined in their respective package directories.

Open the local application URL printed in your terminal.

## Environment Configuration

The following table lists common configuration requirements. Confirm the exact variable names in the source code before using them.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `GEMINI_API_KEY` | Gemini API access for embeddings and any configured AI operations |
| Authentication secrets and URLs | Secure authentication and callback configuration |
| Application URL variables | Frontend and backend origin configuration |

Keep local environment files out of version control. Use your hosting provider's secret-management settings for production credentials.

## Document Indexing

The Knowledge Assistant depends on indexed documents.

The indexing process generally involves:

1. Extracting supported document content.
2. Normalizing and splitting the content into chunks.
3. Generating embeddings for each chunk.
4. Persisting chunks and embeddings.
5. Updating the indexing job status.

Documents must be indexed successfully before their content can be retrieved through the Knowledge Assistant. Indexing availability depends on the document types and processing paths implemented in the application.

## Security Considerations

- Enforce workspace membership and document permissions on the backend.
- Validate user input at API boundaries.
- Keep API keys and database credentials in environment variables.
- Apply appropriate rate limits to AI endpoints.
- Avoid exposing private workspace content across authorization boundaries.
- Use secure authentication and session configuration.
- Apply database migrations carefully in production.
- Review logging practices to avoid recording sensitive document content or credentials.

## Development

Run the checks configured by the repository:

```bash
bun run lint
bun run check-types
bun run build
```

Run these commands from the repository root when the corresponding scripts are defined there.

If automated tests are present, execute the relevant test scripts before merging changes. Verify the exact test command in the project's package scripts.

## Deployment

Before deploying a new version:

1. Configure all required production environment variables.
2. Provision PostgreSQL with pgvector support.
3. Apply the required database migrations.
4. Configure the Gemini API key and review API usage limits.
5. Deploy the frontend and backend using the hosting configuration supported by the repository.
6. Verify authentication, workspace permissions, document indexing, and AI question answering.
7. Check application logs and indexing job failures after deployment.

The frontend, backend, and database may require separate deployment configuration depending on the hosting providers used.

## Project Structure

The project uses a monorepo layout. The main application areas include:

```text
Workspace-ai/
├── apps/
│   ├── api/          # Backend API and application services
│   └── web/          # Next.js frontend
├── packages/
│   └── db/           # Prisma schema and database migrations
├── package.json      # Root scripts and workspace configuration
└── README.md
```

Other configuration and shared packages may exist in the repository.

## Current Scope

Workspace AI brings together collaborative workspaces, document management, and AI-assisted knowledge retrieval.

Its Knowledge Assistant uses document indexing and vector-based retrieval to help users find information across workspace documents.

## Future Improvements

Potential areas for further development include:

- More document formats and extraction strategies.
- Improved retrieval quality and relevance evaluation.
- Better indexing failure recovery and observability.
- Expanded automated integration and end-to-end coverage.
- Additional collaboration and workspace productivity features.

## Contributing

Contributions and suggestions are welcome.

1. Create a feature branch.
2. Make focused, maintainable changes.
3. Run the applicable lint, type-check, build, and test commands.
4. Open a pull request with a clear summary of the changes.

## License

No license has been specified here. Add a `LICENSE` file and update this section before presenting the project as open source.

---

**Workspace AI** — collaborative workspaces with AI-powered knowledge retrieval.

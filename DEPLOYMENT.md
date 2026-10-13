# WorkspaceAI Deployment

This guide describes a demo-oriented deployment with:
- Vercel for the Next.js frontend
- Render for the REST API
- Render for the Hocuspocus collaboration service
- Neon for PostgreSQL

Free hosting plans have usage limits and cold starts. This setup is for a portfolio demo, not production-critical workloads.

## 1. Configure PostgreSQL

Create a PostgreSQL project in Neon and copy its connection string.

Configure `DATABASE_URL` locally for the database package, then run:

```bash
bun --cwd packages/db generate
bun --cwd packages/db run migrate:deploy
# fuchsclan web template

Local development workspace for a reusable React frontend and Express API.

## Requirements

- Node.js 22+ and npm, or Docker with Compose

## Run with Node

```sh
cp .env.example .env
npm install
npm run dev
```

Open <http://localhost:5173>. The API health endpoint is available at <http://localhost:3000/api/health>.

## Run with Docker

```sh
cp .env.example .env
docker compose up --build
```

Source files are mounted into the container, so both services reload as files change.

## Commands

- `npm run dev` — start frontend and backend with reload
- `npm run typecheck` — type-check both workspaces
- `npm run build` — create production builds
- `npm run task:start -- <TASK-ID> <title>` — create a dedicated task branch
- `npm run task:complete -- <title>` — commit a completed task with the required message

Run `npm run governance:install` once after cloning to enable the tracked Git checks. See [Git task governance](docs/git-governance.md) for the required branch and commit conventions.

Environment variables are documented in `.env.example`. Keep local `.env` files out of version control.

## Production

The production image serves the built website and API from one origin on port 80, with uploaded media in a persistent volume. See [the Proxmox VM deployment runbook](docs/production-deployment.md).

## Automated artifacts

The `Build and publish artifacts` GitHub Actions workflow type-checks and builds every pull request and push to `main`. Every run uploads a 30-day application archive with a SHA-256 checksum. Pushes to `main` also publish multi-architecture (`amd64` and `arm64`) container images to `ghcr.io/<owner>/<repository>`.

To create a versioned container image and GitHub Release, push a semantic version tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The tag publishes `1.0.0`, `1.0`, `sha-<commit>`, and `latest` container tags, then attaches the application archive and checksum to the GitHub Release. The workflow uses the repository-provided `GITHUB_TOKEN`; no custom secret is required. Repository Actions settings must allow read and write workflow permissions for package and release publication.

## Image management

Open **Inhalte verwalten** and select **Bilder** to upload, rename, reorder, place, or delete images. New uploads are shown in the public gallery by default and can be changed to **Nur Bibliothek** to keep them off the website without deleting them.

The API accepts JPEG, PNG, WebP, and GIF files up to 10 MB. Image files and their metadata persist under `MEDIA_DATA_DIR` (`data/media` by default); mount or back up that directory in production.

## Booking management

Open **Inhalte verwalten** and select **Buchungen** to create, view, edit, confirm, or delete bookings. No administration key is required.

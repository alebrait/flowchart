# Flowchart

A visual editor for creating and saving process maps. The application uses
Django and Django REST Framework for its API, with React, TypeScript, Vite, and
React Flow for the editor.

## Requirements

- Python 3.12 or newer
- Node.js 20.19 or newer and npm
- PostgreSQL is optional for local development; SQLite is the default

## Local development

### First-time setup

1. Install Python 3.12 or newer, Node.js 20.19 or newer, and npm.

2. Open a terminal in the project root (the folder containing `start-dev.sh`).
Use the existing root-level `.env` file. If you are setting up a new copy and
the file is missing, create it and generate a development key by running:

```sh
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

For a new `.env`, copy the generated value into the `SECRET_KEY` field below
and add these settings. Keep your existing configuration if `.env` is already
configured:

```dotenv
SECRET_KEY=paste-the-generated-value-here
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The `.env` file is local configuration and is ignored by Git. Do not commit it
or reuse its development secret in a deployment.

3. From the project root, create and configure the Python environment, install
the backend dependencies, and create the database tables:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
python backend/manage.py migrate
```

4. (Optional) Create an administrator account for Django admin and access to
all diagrams:

```sh
python backend/manage.py createsuperuser
```

5. Install frontend dependencies:

```sh
cd frontend
npm ci
cd ..
```

### Start and stop the app

After first-time setup, use these steps each time you want to run the app:

1. Open a terminal and change to the project root (the folder containing
`start-dev.sh`).

2. Start Django and Vite together:

```sh
./start-dev.sh
```

The script automatically uses `.venv` or `backend/.venv`, so you do not need
to activate the virtual environment before running it. It requires the root
`.env` and installed frontend dependencies, checks that ports 8000 and 5173
are available, and runs Django's system checks before starting the servers.

If the shell reports `Permission denied`, run `chmod +x start-dev.sh` once,
then run `./start-dev.sh` again. If a port is already in use, stop the existing
server and retry.

3. Open <http://127.0.0.1:5173>. Vite proxies `/api` and `/admin` requests to
Django on port 8000. Keep the terminal running while you use the app.

4. To stop both development servers, focus the terminal running the script and
press **Ctrl+C**.

Alternatively, in VS Code choose **Terminal → Run Task… → Flowchart: Start
app**. It runs the same script; open the same URL and press **Ctrl+C** in the
task terminal to stop the servers.

## Configuration

Environment variables are read from the root `.env` file or the process
environment. `DATABASE_URL` is optional; without it, Django stores data in
`backend/db.sqlite3`. To use PostgreSQL, set a URL such as
`postgres://user:password@localhost:5432/flowchart`.

Never reuse the local development secret in a deployment. Set `DEBUG=False`,
configure `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`, and use a
production-grade secret key before deployment.

## API contracts

The API is served under `/api/`. Session authentication is used, and every
mutation requires the `csrftoken` cookie plus the matching `X-CSRFToken` header.
Call `GET /api/csrf/` before the first mutation. The Vite proxy keeps development
requests same-origin.

- `POST /api/auth/register/` accepts `username` and `password`.
- `POST /api/auth/login/` accepts the same fields; `POST /api/auth/logout/`
  clears the session. `GET /api/auth/me/` returns the current user or `null`.
- `GET, POST /api/diagrams/` lists visible diagrams or creates one from `title`
  and `description`.
- `GET, PATCH, DELETE /api/diagrams/{id}/` reads, renames, or deletes a diagram.
- `POST /api/diagrams/{id}/duplicate/` creates an independent copy with new
  node and edge IDs.
- `GET, PUT /api/diagrams/{id}/graph/` loads or saves one complete graph.

Graph saves send `expected_revision`, `title`, `description`, `viewport`, and
complete `nodes` and `edges` arrays. Omitting a previously saved node or edge
deletes it. A successful save returns the updated graph and revision; a stale
revision returns HTTP 409 and does not overwrite the existing graph. Nodes and
edges use UUID IDs. Edge endpoint IDs must reference nodes in the same submitted
graph. The server rejects unknown shape, port, colour, and line-style values.

## Backend checks

With the virtual environment active and `.env` configured:

```sh
python backend/manage.py test diagrams
python backend/manage.py makemigrations --check --dry-run
```

Run the frontend checks from a second terminal:

```sh
cd frontend
npm ci
npm test
npm run lint
npm run build
```

`npm run build` runs the TypeScript project build before producing static files
in `frontend/dist`.

## Architecture

- `backend/config` configures Django, sessions, CSRF, SQLite/PostgreSQL, and the
  admin site. `backend/diagrams` owns accounts, diagrams, nodes, edges, and the
  REST API.
- Diagram graph saves are complete snapshots guarded by an expected revision.
  Validation and persistence are atomic; ownership is enforced on the API.
- `frontend/src` contains the React/TypeScript dashboard and React Flow editor.
  Graph serialization is shared by saving, recovery, and exporting.
- Undo/redo is in-memory. Unsaved work is autosaved to the server and copied to
  user-and-diagram-scoped browser storage for recovery after failures.
- SVG export is generated as standalone vector markup without embedded HTML.
  PNG export rasterizes that SVG in the browser.

## Production outline

The Vite development server is not a production server. Build the frontend,
apply migrations, and collect Django static files during deployment:

```sh
cd frontend
npm ci
npm run build
cd ..
python backend/manage.py migrate
python backend/manage.py collectstatic --noinput
```

Run `config.wsgi:application` with a production WSGI server and serve
`frontend/dist` plus Django's `STATIC_ROOT` (`backend/staticfiles`) from a
reverse proxy or equivalent static-file service. Route `/api/` and `/admin/` to
Django, and configure the public hosts, HTTPS CSRF origins, secure cookies,
database URL, and a unique `SECRET_KEY` through the environment. Set
`DEBUG=False`; do not expose Django's development server in production. This
repository does not bundle a WSGI server or a deployment-specific proxy
configuration, so operators must select and configure those for their hosting
environment.

## Current limitations

- Recovery drafts use this browser's `localStorage`; they are not synchronized
  between browsers and cannot be stored when browser storage is unavailable.
- Export uses the current graph regardless of zoom or scroll position.
  SVG text wrapping uses a conservative character-width estimate and relies on
  fonts available in the viewing system; unusual fonts or glyph metrics can
  shift line wrapping. The SVG contains no `foreignObject`, improving
  portability to standard SVG viewers.
- PNG export is rendered by the current browser and is capped at 8192 pixels
  on the longest side and 32 million total pixels to bound memory use. Export
  backgrounds can be transparent or white.
- There is no real-time multi-user collaboration, diagram import, or
  share-by-link permission model. Superusers can edit diagrams across owners;
  ordinary users remain owner-scoped.

## Dependencies and licences

The backend uses Django and Django REST Framework (BSD licences),
django-environ (MIT), and psycopg 3 (LGPL with its PostgreSQL exception).
The frontend uses React, Vite, `@xyflow/react`, Vitest, Oxlint, JSDOM, and
Testing Library (MIT licences), plus TypeScript (Apache 2.0). Direct Python dependency
versions are in `backend/requirements.txt`; exact JavaScript
versions are in `frontend/package-lock.json`.

## Features

The application supports account registration and session login, an
owner-scoped diagram dashboard, diagram create/rename/duplicate/delete,
shape editing and connections, advanced routing, undo/redo, sequenced
autosaving, browser recovery drafts, stale-revision conflict handling, and
SVG/PNG export.

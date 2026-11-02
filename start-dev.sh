#!/usr/bin/env bash
set -uo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
elif [[ -x "$PROJECT_ROOT/backend/.venv/bin/python" ]]; then
  PYTHON="$PROJECT_ROOT/backend/.venv/bin/python"
else
  echo "Backend virtual environment not found. Follow the setup instructions in README.md first."
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/frontend/node_modules/.bin/vite" ]]; then
  echo "Frontend dependencies not found. Run 'npm ci' from the frontend directory first."
  exit 1
fi

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Missing .env. Follow the configuration instructions in README.md first."
  exit 1
fi

port_in_use() {
  "$PYTHON" -c 'import socket, sys; connection = socket.socket(); connection.settimeout(0.25); result = connection.connect_ex(("127.0.0.1", int(sys.argv[1]))); connection.close(); sys.exit(0 if result == 0 else 1)' "$1"
}

for PORT in 8000 5173; do
  if port_in_use "$PORT"; then
    echo "Port $PORT is already in use. Stop the existing server before starting another copy."
    exit 1
  fi
done

"$PYTHON" "$PROJECT_ROOT/backend/manage.py" check || exit $?

echo "Starting Django at http://127.0.0.1:8000"
"$PYTHON" "$PROJECT_ROOT/backend/manage.py" runserver 127.0.0.1:8000 &
DJANGO_PID=$!

echo "Starting React at http://127.0.0.1:5173"
(
  cd "$PROJECT_ROOT/frontend"
  ./node_modules/.bin/vite --host 127.0.0.1 --strictPort
) &
VITE_PID=$!

cleanup() {
  trap - INT TERM EXIT
  kill "$DJANGO_PID" "$VITE_PID" 2>/dev/null || true
  wait "$DJANGO_PID" 2>/dev/null || true
  wait "$VITE_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT
wait -n "$DJANGO_PID" "$VITE_PID"
STATUS=$?
exit "$STATUS"

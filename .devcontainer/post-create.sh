#!/usr/bin/env bash
# Runs once when the codespace is created: Postgres client, dependencies,
# migrations, and a shell hook so every terminal derives the public URL.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pg_isready > /dev/null 2>&1; then
  echo "Installing postgresql-client..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq --no-install-recommends postgresql-client
fi

echo "Waiting for Postgres..."
for i in $(seq 1 60); do
  if pg_isready -h postgres -U postgres -d app > /dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Postgres did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

npm ci

# Derive PUBLIC_BASE_URL, BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL in every
# interactive shell, so `npm run dev` from a terminal sees the same values
# the lifecycle hooks use.
HOOK="source $(pwd)/scripts/codespace-env.sh"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ] && ! grep -qF "$HOOK" "$rc"; then
    printf '\n# Bat Phone: derive the public URL inside Codespaces\n%s\n' "$HOOK" >> "$rc"
  fi
done

# shellcheck source=../scripts/codespace-env.sh
source scripts/codespace-env.sh
npm run db:migrate

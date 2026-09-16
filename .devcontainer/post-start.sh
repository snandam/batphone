#!/usr/bin/env bash
# Runs on every start: apply new migrations, then point the Twilio number at
# this codespace's public URL when the API key secrets are present. Never
# fails the start; a broken Twilio call is reported and the codespace stays
# usable.
set -uo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=../scripts/codespace-env.sh
source scripts/codespace-env.sh

echo "Waiting for Postgres..."
for i in $(seq 1 60); do
  if pg_isready -h postgres -U postgres -d app > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! npm run db:migrate; then
  echo "WARNING: db:migrate failed. Run 'npm run db:migrate' after fixing the database." >&2
fi

if [ -n "${TWILIO_API_KEY_SID:-}" ]; then
  if ! npm run twilio:configure; then
    echo "WARNING: twilio:configure failed. Fix the Twilio secrets and run 'npm run twilio:configure'." >&2
  fi
else
  echo "TWILIO_API_KEY_SID is not set; skipping twilio:configure. Add the Codespaces secrets and run 'npm run twilio:configure'."
fi

exit 0

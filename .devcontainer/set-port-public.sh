#!/usr/bin/env bash
# Runs on attach: make port 3000 public so Twilio can reach the webhooks
# without a GitHub login. `visibility` is not a devcontainer.json key, so
# this goes through the gh CLI with the GH_TOKEN repository secret. Any
# failure prints the manual step and exits 0 so attach stays usable. Bound
# the CLI wait: its tunnel-readiness check can stall even when the codespace
# is already Available, particularly before the app starts listening.
set -uo pipefail

MANUAL="Manual step: open the Ports panel, right-click port 3000 (Bat Phone), Port Visibility, Public."

if [ "${CODESPACES:-}" != "true" ]; then
  exit 0
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo "WARNING: GH_TOKEN is not set, cannot set port 3000 public automatically. $MANUAL" >&2
  exit 0
fi

if ! command -v gh > /dev/null 2>&1; then
  echo "WARNING: gh CLI is not installed, cannot set port 3000 public automatically. $MANUAL" >&2
  exit 0
fi

if ! command -v timeout > /dev/null 2>&1; then
  echo "WARNING: timeout is not installed; skipping automatic port setup. $MANUAL" >&2
  exit 0
fi

if GH_PROMPT_DISABLED=1 timeout --kill-after=5s 20s gh codespace ports visibility 3000:public -c "$CODESPACE_NAME"; then
  echo "Port 3000 is public: https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  port_status=$?
  if [ "$port_status" -eq 124 ] || [ "$port_status" -eq 137 ]; then
    echo "WARNING: automatic port setup timed out. Start the app with 'npm run dev', then set the port public manually. $MANUAL" >&2
  else
    echo "WARNING: 'gh codespace ports visibility 3000:public' failed. Check that GH_TOKEN permits Codespaces port changes. $MANUAL" >&2
  fi
fi

exit 0

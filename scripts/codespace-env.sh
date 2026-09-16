#!/usr/bin/env bash
# Source this file; do not execute it. Derives the public URL inside a
# GitHub Codespace and mirrors it into the auth and app URL variables. Every
# assignment is skipped when the variable is already set, so an explicit
# PUBLIC_BASE_URL wins. Outside Codespaces it does nothing.

if [ "${CODESPACES:-}" = "true" ] && [ -z "${PUBLIC_BASE_URL:-}" ] \
  && [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  export PUBLIC_BASE_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
  # Strip a trailing slash so every consumer agrees on the exact string.
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
  export PUBLIC_BASE_URL
  : "${BETTER_AUTH_URL:=$PUBLIC_BASE_URL}"
  : "${NEXT_PUBLIC_APP_URL:=$PUBLIC_BASE_URL}"
  export BETTER_AUTH_URL NEXT_PUBLIC_APP_URL
fi

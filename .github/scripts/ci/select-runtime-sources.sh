#!/usr/bin/env bash
set -eo pipefail

case "$EVENT_NAME" in
  pull_request|push)
    sources='["current"]'
    profile=short
    ;;
  workflow_dispatch)
    case "${REQUESTED_SOURCE:-current}" in
      all) sources='["current"]' ;;
      current) sources='["current"]' ;;
      *) exit 1 ;;
    esac
    case "${REQUESTED_PROFILE:-short}" in
      short|long) profile="${REQUESTED_PROFILE:-short}" ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
echo "sources=$sources" >> "$GITHUB_OUTPUT"
echo "profile=$profile" >> "$GITHUB_OUTPUT"

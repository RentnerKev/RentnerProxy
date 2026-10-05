#!/usr/bin/env bash
set -Eeuo pipefail
pattern='^(feat|fix|refactor|perf|test|docs|build|ci|chore|style|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: [^[:space:]].*$'
pr_title="$EVENT_PR_TITLE"

if [[ -z "$pr_title" ]]; then
  if [[ "$GITHUB_REF" =~ ^refs/pull/([1-9][0-9]*)/merge$ ]]; then
    pr_number="${BASH_REMATCH[1]}"
  else
    echo '::error::Could not resolve pull request number.'
    exit 1
  fi
  pr_title="$(
    curl --fail --location --proto '=https' --silent --show-error --tlsv1.2 \
      --header 'Accept: application/vnd.github+json' \
      --header "Authorization: Bearer $GITHUB_TOKEN" \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      "$GITHUB_API_URL/repos/$REPOSITORY/pulls/$pr_number" |
      jq --exit-status --raw-output '.title | strings | select(length > 0)'
  )"
fi

if [[ "$pr_title" =~ [[:cntrl:]] || ! "$pr_title" =~ $pattern ]]; then
  echo "Pull request title must follow Conventional Commits."
  echo "Expected: type(scope): description or type: description"
  echo "Allowed types: feat, fix, refactor, perf, test, docs, build, ci, chore, style, revert"
  exit 1
fi

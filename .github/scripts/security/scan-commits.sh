#!/usr/bin/env bash
set -eo pipefail

zero_sha='0000000000000000000000000000000000000000'
config_path="$RUNNER_TEMP/gitleaks.toml"
ignore_path="$RUNNER_TEMP/.gitleaksignore"

printf '%s\n' '[extend]' 'useDefault = true' > "$config_path"
# These historical findings are synthetic controller test tokens, not credentials.
# Exempt only those exact occurrences; all new findings still fail the scan.
printf '%s\n' \
    'cbaa7450afc314e4dcd3bda162660795ac4021d6:controller/src/tests/server.rs:generic-api-key:544' \
    '9850a9044c0c18870337009d4eee60ec059d54ba:controller/src/tests/server.rs:generic-api-key:645' > "$ignore_path"

case "$EVENT_NAME" in
    pull_request)
        scan_log_opts="-m ${PR_BASE_SHA}..${PR_HEAD_SHA}"
        ;;
    push)
        if [[ -z "$PUSH_BEFORE_SHA" || "$PUSH_BEFORE_SHA" == "$zero_sha" ]] || \
            ! git cat-file -e "${PUSH_BEFORE_SHA}^{commit}" 2>/dev/null; then
            scan_log_opts="-m $PUSH_AFTER_SHA"
        else
            scan_log_opts="-m ${PUSH_BEFORE_SHA}..${PUSH_AFTER_SHA}"
        fi
        ;;
    workflow_dispatch)
        scan_log_opts='-m --all'
        ;;
    *)
        echo "Unsupported event: $EVENT_NAME"
        exit 1
        ;;
esac

"$RUNNER_TEMP/gitleaks" git --config="$config_path" \
    --gitleaks-ignore-path="$ignore_path" --redact=100 \
    --no-banner --no-color --verbose --log-opts="$scan_log_opts" .

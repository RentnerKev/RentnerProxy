#!/usr/bin/env bash

set -Eeuo pipefail

readonly config_file=/usr/share/rentnerproxy/crowdsec/config.yaml
readonly online_config_file=/usr/share/rentnerproxy/crowdsec/config-online.yaml
readonly control_directory=/run/rentnerproxy/crowdsec
readonly status_staging_directory=/run/rentnerproxy/crowdsec-supervisor
readonly desired_mode_file="$control_directory/desired-mode"
readonly status_file="$control_directory/status.json"
readonly enrollment_request_file="$control_directory/console-enrollment-request"
readonly enrollment_result_file="$control_directory/console-enrollment-result.json"
readonly state_directory=/var/lib/rentnerproxy/crowdsec
readonly capi_credentials_file="$state_directory/credentials/online_api_credentials.yaml"
readonly console_file="$state_directory/credentials/console.yaml"
readonly bouncer_staging_directory=/var/lib/rentnerproxy/crowdsec-supervisor
readonly bouncer_key_file="$state_directory/bouncer/caddy-bouncer-key"
readonly bouncer_name=rentnerproxy-caddy
readonly machine_name=rentnerproxy-managed
readonly lapi_health_url=http://127.0.0.1:18080/health
readonly max_restarts=5
readonly stable_ready_seconds=60
readonly online_retry_seconds=60
readonly online_probe_seconds=120

engine_pid=''
stopping=false
running_mode=stopped
community_state=disabled
console_state=not_enrolled
next_online_attempt=0
next_online_probe=0
online_suspended_until=0

log() {
    printf '%s\n' "[rentnerproxy:crowdsec] $*" >&2
}

write_status() {
    local state=$1
    local restarts=$2
    local temporary
    temporary=$(mktemp "$status_staging_directory/status.XXXXXX")
    printf '{"state":"%s","restarts":%d,"community":"%s","console":"%s"}\n' \
        "$state" "$restarts" "$community_state" "$console_state" > "$temporary"
    chown root:rentnerproxy "$temporary"
    chmod 0440 "$temporary"
    mv -fT -- "$temporary" "$status_file"
}

desired_mode() {
    local value
    value=$(<"$desired_mode_file")
    case $value in
        managed | managed-online) printf '%s' "$value" ;;
        *) printf '%s' stopped ;;
    esac
}

stop_engine() {
    local deadline
    if [[ -z $engine_pid ]]; then
        running_mode=stopped
        return 0
    fi
    if kill -0 "$engine_pid" 2>/dev/null; then
        kill -TERM "$engine_pid" 2>/dev/null || true
        deadline=$((SECONDS + 12))
        while ((SECONDS < deadline)) && kill -0 "$engine_pid" 2>/dev/null; do
            sleep 1
        done
        if kill -0 "$engine_pid" 2>/dev/null; then
            kill -KILL "$engine_pid" 2>/dev/null || true
        fi
    fi
    wait "$engine_pid" 2>/dev/null || true
    engine_pid=''
    running_mode=stopped
}

write_enrollment_result() {
    local id=$1
    local result=$2
    local temporary
    temporary=$(mktemp "$status_staging_directory/enrollment.XXXXXX")
    printf '{"id":"%s","state":"%s"}\n' "$id" "$result" > "$temporary"
    chown root:rentnerproxy "$temporary"
    chmod 0440 "$temporary"
    mv -fT -- "$temporary" "$enrollment_result_file"
}

ensure_online_credentials() {
    if [[ -e $capi_credentials_file || -L $capi_credentials_file ]]; then
        [[ -f $capi_credentials_file && ! -L $capi_credentials_file ]] || return 1
        [[ $(stat -c '%U:%G' "$capi_credentials_file") == crowdsec:crowdsec ]] || return 1
        chmod 0600 "$capi_credentials_file"
        return 0
    fi
    timeout 25s gosu crowdsec cscli -c "$online_config_file" capi register \
        -f "$capi_credentials_file" >/dev/null 2>&1 || return 1
    [[ -f $capi_credentials_file && ! -L $capi_credentials_file ]] || return 1
    [[ $(stat -c '%U:%G' "$capi_credentials_file") == crowdsec:crowdsec ]] || return 1
    chmod 0600 "$capi_credentials_file"
}

probe_online() {
    if timeout 8s gosu crowdsec cscli -c "$online_config_file" capi status \
        >/dev/null 2>&1; then
        community_state=connected
    else
        community_state=degraded
    fi
    if [[ ! -e $console_file ]]; then
        console_state=not_enrolled
        return
    fi
    if [[ ! -f $console_file || -L $console_file ]]; then
        console_state=degraded
        return
    fi
    local output
    if ! output=$(timeout 8s gosu crowdsec cscli -c "$online_config_file" \
        -o json console status 2>/dev/null); then
        console_state=degraded
    elif grep -Eq '"enrolled"[[:space:]]*:[[:space:]]*true' <<< "$output"; then
        console_state=connected
    else
        console_state=pending
    fi
}

process_console_enrollment() {
    [[ -e $enrollment_request_file || -L $enrollment_request_file ]] || return 0
    local id key
    local -a fields=()
    if [[ ! -f $enrollment_request_file || -L $enrollment_request_file ]] \
        || [[ $(stat -c '%U:%G:%a' "$enrollment_request_file") != rentnerproxy:rentnerproxy:600 ]]; then
        rm -f -- "$enrollment_request_file"
        log 'invalid console enrollment request file'
        return 0
    fi
    mapfile -t fields < "$enrollment_request_file"
    rm -f -- "$enrollment_request_file"
    if (( ${#fields[@]} != 2 )); then
        log 'invalid console enrollment request'
        return 0
    fi
    id=${fields[0]}
    key=${fields[1]}
    if [[ ! $id =~ ^[a-f0-9]{32}$ || ! $key =~ ^[A-Za-z0-9_-]{16,256}$ ]]; then
        log 'invalid console enrollment request'
        return 0
    fi
    if [[ $running_mode != managed-online || $community_state != connected ]]; then
        write_enrollment_result "$id" failed
        return 0
    fi
    if timeout 25s gosu crowdsec cscli -c "$online_config_file" console enroll \
        --disable all "$key" >/dev/null 2>&1; then
        console_state=pending
        write_enrollment_result "$id" pending
        log 'CrowdSec Console enrollment requested; confirm it in the Console'
    else
        console_state=degraded
        write_enrollment_result "$id" failed
        log 'CrowdSec Console enrollment failed'
    fi
    key=''
}

shutdown() {
    stopping=true
    stop_engine
    exit 0
}

generate_bouncer_key() {
    local temporary
    if [[ -e $bouncer_key_file ]]; then
        [[ ! -L $bouncer_key_file && -f $bouncer_key_file ]] || return 1
        [[ $(stat -c '%U:%G:%a' "$bouncer_key_file") == root:rentnerproxy:440 ]] || return 1
        [[ $(<"$bouncer_key_file") =~ ^[a-f0-9]{64}$ ]] || return 1
        return 0
    fi
    temporary=$(mktemp "$bouncer_staging_directory/bouncer-key.XXXXXX")
    if ! openssl rand -hex 32 > "$temporary" \
        || ! chown root:rentnerproxy "$temporary" \
        || ! chmod 0440 "$temporary" \
        || ! mv -fT -- "$temporary" "$bouncer_key_file"; then
        rm -f -- "$temporary"
        return 1
    fi
}

rotate_bouncer_key() {
    local temporary
    if [[ ! -e $bouncer_key_file ]]; then
        generate_bouncer_key
        return
    fi
    generate_bouncer_key || return 1
    temporary=$(mktemp "$bouncer_staging_directory/bouncer-key.XXXXXX")
    if ! openssl rand -hex 32 > "$temporary" \
        || ! chown root:rentnerproxy "$temporary" \
        || ! chmod 0440 "$temporary" \
        || ! mv -fT -- "$temporary" "$bouncer_key_file"; then
        rm -f -- "$temporary"
        return 1
    fi
}

initialize_credentials() {
    local key
    generate_bouncer_key || return 1
    if ! gosu crowdsec cscli -c "$config_file" machines list -o json 2>/dev/null \
        | grep -Fq "\"machineId\": \"$machine_name\""; then
        gosu crowdsec cscli -c "$config_file" machines delete "$machine_name" \
            >/dev/null 2>&1 || true
        gosu crowdsec cscli -c "$config_file" machines add "$machine_name" --auto --force \
            >/dev/null 2>&1 || return 1
    fi
    key=$(<"$bouncer_key_file")
    gosu crowdsec cscli -c "$config_file" bouncers delete "$bouncer_name" \
        >/dev/null 2>&1 || true
    gosu crowdsec cscli -c "$config_file" bouncers add "$bouncer_name" --key "$key" \
        >/dev/null 2>&1 || return 1
}

start_engine() {
    local selected_config=$config_file
    local -a start_flags=(-no-capi)
    initialize_credentials || return 1
    running_mode=managed
    if [[ $(desired_mode) == managed-online && SECONDS -ge online_suspended_until && -f $capi_credentials_file && ! -L $capi_credentials_file ]]; then
        if timeout 15s gosu crowdsec crowdsec -t -c "$online_config_file" >/dev/null 2>&1; then
            selected_config=$online_config_file
            start_flags=()
            running_mode=managed-online
            community_state=starting
        else
            community_state=degraded
            next_online_attempt=$((SECONDS + online_retry_seconds))
            log 'online CrowdSec validation failed; local protection remains active'
        fi
    fi
    timeout 15s gosu crowdsec crowdsec -t -c "$selected_config" \
        >/dev/null 2>&1 || return 1
    gosu crowdsec crowdsec -c "$selected_config" "${start_flags[@]}" &
    engine_pid=$!
}

wait_until_ready() {
    local attempt
    for attempt in $(seq 1 30); do
        [[ $(desired_mode) != stopped ]] || return 2
        kill -0 "$engine_pid" 2>/dev/null || return 1
        if curl --fail --silent --show-error --max-time 1 "$lapi_health_url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

trap shutdown INT TERM

write_status stopped 0
restarts=0
blocked=false
rotate_on_activation=true

while ! $stopping; do
    if [[ $(desired_mode) == stopped ]]; then
        stop_engine
        restarts=0
        blocked=false
        rotate_on_activation=true
        community_state=disabled
        console_state=not_enrolled
        write_status stopped 0
        sleep 1
        continue
    fi

    if $blocked; then
        write_status degraded "$restarts"
        sleep 1
        continue
    fi

    if $rotate_on_activation; then
        if ! rotate_bouncer_key; then
            log 'managed bouncer credential rotation failed'
            blocked=true
            write_status degraded "$restarts"
            continue
        fi
        log 'managed bouncer credential rotated'
        rotate_on_activation=false
    fi

    write_status starting "$restarts"
    if ! start_engine; then
        log 'managed engine initialization failed'
        blocked=true
        write_status degraded "$restarts"
        continue
    fi
    if ! wait_until_ready; then
        failed_mode=$running_mode
        stop_engine
        if [[ $(desired_mode) == stopped ]]; then
            continue
        fi
        if [[ $failed_mode == managed-online ]]; then
            online_suspended_until=$((SECONDS + online_retry_seconds))
            next_online_attempt=$online_suspended_until
            community_state=degraded
            write_status restarting "$restarts"
            log 'online CrowdSec failed to become ready; restoring local protection'
            continue
        fi
        restarts=$((restarts + 1))
        if ((restarts >= max_restarts)); then
            log 'managed engine restart budget exhausted'
            blocked=true
            write_status degraded "$restarts"
            continue
        fi
        sleep $((1 << (restarts - 1)))
        continue
    fi

    write_status ready "$restarts"
    ready_since=$SECONDS
    mode_switch=false
    while [[ $(desired_mode) != stopped ]] && kill -0 "$engine_pid" 2>/dev/null; do
        desired=$(desired_mode)
        if [[ $running_mode == managed && $desired == managed && $community_state != disabled ]]; then
            community_state=disabled
            console_state=not_enrolled
            next_online_attempt=0
            online_suspended_until=0
            write_status ready "$restarts"
        fi
        if [[ $running_mode == managed-online && $desired == managed ]]; then
            stop_engine
            mode_switch=true
            community_state=disabled
            console_state=not_enrolled
            break
        fi
        if [[ $running_mode == managed && $desired == managed-online && SECONDS -ge next_online_attempt ]]; then
            next_online_attempt=$((SECONDS + online_retry_seconds))
            if ensure_online_credentials && timeout 8s gosu crowdsec cscli \
                -c "$online_config_file" capi status >/dev/null 2>&1; then
                stop_engine
                mode_switch=true
                community_state=starting
                break
            fi
            community_state=degraded
            write_status ready "$restarts"
            log 'CrowdSec Central API unavailable; retrying while local protection remains active'
        fi
        if [[ $running_mode == managed-online && SECONDS -ge next_online_probe ]]; then
            probe_online
            next_online_probe=$((SECONDS + online_probe_seconds))
            write_status ready "$restarts"
        fi
        if [[ -e $enrollment_request_file || -L $enrollment_request_file ]]; then
            process_console_enrollment
            write_status ready "$restarts"
        fi
        sleep 1
    done
    if [[ $(desired_mode) == stopped ]]; then
        stop_engine
        continue
    fi
    if $mode_switch; then
        continue
    fi
    wait "$engine_pid" 2>/dev/null || true
    engine_pid=''
    if [[ $running_mode == managed-online ]]; then
        running_mode=stopped
        online_suspended_until=$((SECONDS + online_retry_seconds))
        next_online_attempt=$online_suspended_until
        community_state=degraded
        write_status restarting "$restarts"
        log 'online CrowdSec exited; restoring local protection'
        continue
    fi
    if ((SECONDS - ready_since >= stable_ready_seconds)); then
        restarts=0
    fi
    restarts=$((restarts + 1))
    if ((restarts >= max_restarts)); then
        log 'managed engine restart budget exhausted'
        blocked=true
        write_status degraded "$restarts"
    else
        write_status restarting "$restarts"
        sleep $((1 << (restarts - 1)))
    fi
done

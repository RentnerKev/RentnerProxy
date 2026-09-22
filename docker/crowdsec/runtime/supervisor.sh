#!/usr/bin/env bash

set -Eeuo pipefail

readonly config_file=/usr/share/rentnerproxy/crowdsec/config.yaml
readonly control_directory=/run/rentnerproxy/crowdsec
readonly desired_mode_file="$control_directory/desired-mode"
readonly status_file="$control_directory/status.json"
readonly state_directory=/var/lib/rentnerproxy/crowdsec
readonly credentials_directory="$state_directory/credentials"
readonly bouncer_key_file="$state_directory/bouncer/caddy-bouncer-key"
readonly bouncer_name=rentnerproxy-caddy
readonly machine_name=rentnerproxy-managed
readonly lapi_health_url=http://127.0.0.1:18080/health
readonly max_restarts=5

engine_pid=''
stopping=false

log() {
    printf '%s\n' "[rentnerproxy:crowdsec] $*" >&2
}

write_status() {
    local state=$1
    local restarts=$2
    local temporary
    temporary=$(mktemp "$control_directory/.status.XXXXXX")
    printf '{"state":"%s","restarts":%d}\n' "$state" "$restarts" > "$temporary"
    chown root:rentnerproxy "$temporary"
    chmod 0440 "$temporary"
    mv -f -- "$temporary" "$status_file"
}

desired_mode() {
    local value
    value=$(<"$desired_mode_file")
    if [[ $value == managed ]]; then
        printf '%s' managed
    else
        printf '%s' stopped
    fi
}

stop_engine() {
    local deadline
    [[ -n $engine_pid ]] || return 0
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
    temporary=$(mktemp "$credentials_directory/.bouncer-key.XXXXXX")
    openssl rand -hex 32 > "$temporary"
    chown root:rentnerproxy "$temporary"
    chmod 0440 "$temporary"
    mv -- "$temporary" "$bouncer_key_file"
}

rotate_bouncer_key() {
    local temporary
    if [[ ! -e $bouncer_key_file ]]; then
        generate_bouncer_key
        return
    fi
    generate_bouncer_key || return 1
    temporary=$(mktemp "$credentials_directory/.bouncer-key.XXXXXX")
    if ! openssl rand -hex 32 > "$temporary" \
        || ! chown root:rentnerproxy "$temporary" \
        || ! chmod 0440 "$temporary" \
        || ! mv -f -- "$temporary" "$bouncer_key_file"; then
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
    initialize_credentials || return 1
    gosu crowdsec crowdsec -t -c "$config_file" >/dev/null 2>&1 || return 1
    gosu crowdsec crowdsec -c "$config_file" -no-capi &
    engine_pid=$!
}

wait_until_ready() {
    local attempt
    for attempt in $(seq 1 30); do
        [[ $(desired_mode) == managed ]] || return 2
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
    if [[ $(desired_mode) != managed ]]; then
        stop_engine
        restarts=0
        blocked=false
        rotate_on_activation=true
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
        stop_engine
        if [[ $(desired_mode) != managed ]]; then
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
    while [[ $(desired_mode) == managed ]] && kill -0 "$engine_pid" 2>/dev/null; do
        sleep 1
    done
    if [[ $(desired_mode) != managed ]]; then
        stop_engine
        continue
    fi
    wait "$engine_pid" 2>/dev/null || true
    engine_pid=''
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

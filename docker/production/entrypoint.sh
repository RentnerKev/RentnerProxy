#!/usr/bin/env bash

set -Eeuo pipefail

readonly app_directory=/opt/rentnerproxy/web
readonly data_directory=/var/lib/rentnerproxy
readonly postgres_directory="$data_directory/postgres-data"
readonly proxy_directory="$data_directory/proxy"
readonly bootstrap_directory="$data_directory/bootstrap"
readonly app_key_file=/run/rentnerproxy/app-key/value
readonly controller_token_file=/run/rentnerproxy/controller-token/value
readonly database_url_file=/run/rentnerproxy/database-url/value
readonly postgres_password_file=/run/rentnerproxy/postgres/value
readonly redis_directory=/opt/rentnerproxy/redis
readonly postgres_user=rentnerproxy
readonly postgres_database=rentnerproxy

declare -a child_pids=()
declare -a child_names=()

log() {
    printf '%s\n' "[rentnerproxy] $*" >&2
}

shutdown_children() {
    local deadline pid

    trap - EXIT INT TERM
    for pid in "${child_pids[@]:-}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    deadline=$((SECONDS + 25))
    while ((SECONDS < deadline)); do
        local running=false
        for pid in "${child_pids[@]:-}"; do
            if kill -0 "$pid" 2>/dev/null; then
                running=true
                break
            fi
        done
        "$running" || break
        sleep 1
    done

    for pid in "${child_pids[@]:-}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
    for pid in "${child_pids[@]:-}"; do
        wait "$pid" 2>/dev/null || true
    done
}

on_shutdown_signal() {
    log 'shutdown signal received'
    exit 0
}

fatal() {
    log "fatal: $*"
    exit 1
}

start_child() {
    local name=$1
    shift
    "$@" &
    child_pids+=("$!")
    child_names+=("$name")
}

assert_children_running() {
    local index
    for index in "${!child_pids[@]}"; do
        if ! kill -0 "${child_pids[$index]}" 2>/dev/null; then
            fatal "${child_names[$index]} stopped while the appliance was starting"
        fi
    done
}

wait_for_command() {
    local label=$1
    shift
    local attempt
    for attempt in $(seq 1 60); do
        if "$@" >/dev/null 2>&1; then
            return
        fi
        assert_children_running
        sleep 1
    done
    fatal "timed out waiting for $label"
}

initialize_layout() {
    [[ $(id -u) == 0 ]] || fatal 'the production entrypoint must start as root'

    install -d -m 0711 -o root -g root "$data_directory"
    install -d -m 0700 -o postgres -g postgres "$postgres_directory"
    install -d -m 0700 -o rentnerproxy -g rentnerproxy "$proxy_directory"
    install -d -m 0700 -o root -g root "$bootstrap_directory"
    install -d -m 2775 -o postgres -g postgres /var/run/postgresql
}

initialize_secrets() {
    RENTNERPROXY_DATABASE_HOST=127.0.0.1 bun "$app_directory/docker/web/bootstrap-secrets.mjs"

    # Bootstrap creates the common directory as root:0700.  Each service needs
    # traversal only to its own 0700 directory, never directory listing access.
    chmod 0711 /run/rentnerproxy
    chown rentnerproxy:rentnerproxy "$(dirname "$app_key_file")" \
        "$(dirname "$controller_token_file")" \
        "$(dirname "$database_url_file")"
    chmod 0700 "$(dirname "$app_key_file")" \
        "$(dirname "$controller_token_file")" \
        "$(dirname "$database_url_file")"
    chown rentnerproxy:rentnerproxy "$app_key_file" "$controller_token_file" "$database_url_file"
    chmod 0400 "$app_key_file" "$controller_token_file" "$database_url_file"
    chown postgres:postgres "$(dirname "$postgres_password_file")"
    chmod 0700 "$(dirname "$postgres_password_file")"
    chown postgres:postgres "$postgres_password_file"
    chmod 0400 "$postgres_password_file"
}

initialize_postgres_data_directory() {
    if [[ -e "$postgres_directory/PG_VERSION" ]]; then
        [[ -s "$postgres_directory/PG_VERSION" ]] || fatal 'PostgreSQL data directory is invalid'
        return
    fi

    if [[ -n $(find "$postgres_directory" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
        fatal 'PostgreSQL data directory is non-empty but uninitialized'
    fi

    log 'initializing PostgreSQL data directory'
    gosu postgres initdb \
        --auth-host=scram-sha-256 \
        --auth-local=trust \
        --encoding=UTF8 \
        --no-locale \
        --pwfile="$postgres_password_file" \
        --username="$postgres_user" \
        --pgdata="$postgres_directory"
}

ensure_application_database() {
    local postgres_password
    postgres_password=$(<"$postgres_password_file")
    if env PGPASSWORD="$postgres_password" gosu postgres psql \
        --host=127.0.0.1 \
        --username="$postgres_user" \
        --dbname=postgres \
        --tuples-only \
        --no-align \
        --command="SELECT 1 FROM pg_database WHERE datname = '$postgres_database'" | grep -qx 1; then
        unset postgres_password
        return
    fi
    env PGPASSWORD="$postgres_password" gosu postgres createdb \
        --host=127.0.0.1 \
        --username="$postgres_user" \
        "$postgres_database"
    unset postgres_password
}

start_postgres() {
    start_child postgres gosu postgres postgres \
        -D "$postgres_directory" \
        -c listen_addresses=127.0.0.1 \
        -c port=5432 \
        -c unix_socket_directories=/var/run/postgresql
    wait_for_command 'PostgreSQL' gosu postgres pg_isready \
        --host=127.0.0.1 \
        --username="$postgres_user" \
        --dbname=postgres
    ensure_application_database
}

start_redis() {
    start_child redis gosu rentnerproxy "$redis_directory/bin/redis-server" \
        --appendonly no \
        --bind 127.0.0.1 \
        --daemonize no \
        --dir /tmp \
        --logfile '' \
        --port 6379 \
        --protected-mode yes \
        --save ''
    wait_for_command Redis gosu rentnerproxy "$redis_directory/bin/redis-cli" -h 127.0.0.1 ping
}

start_controller() {
    start_child controller env \
        RENTNERPROXY_CONTROLLER_LISTEN_ADDR=127.0.0.1:8081 \
        RENTNERPROXY_CONTROLLER_TOKEN_FILE="$controller_token_file" \
        RENTNERPROXY_PROXY_ENGINE_BIN=/usr/local/openresty/nginx/sbin/nginx \
        RENTNERPROXY_PROXY_HTTP_PORT=8080 \
        RENTNERPROXY_PROXY_HTTPS_PORT=8443 \
        RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT="${RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT:-443}" \
        RENTNERPROXY_PROXY_STATE_DIR="$proxy_directory" \
        RENTNERPROXY_SYSTEM_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
        RUST_LOG="${RUST_LOG:-info}" \
        gosu rentnerproxy /usr/local/bin/rentnerproxy-controller
    wait_for_command 'proxy controller' gosu rentnerproxy /usr/local/bin/rentnerproxy-controller \
        --healthcheck ready
}

run_migrations() {
    log 'running database migrations'
    (
        cd "$app_directory"
        exec env DATABASE_URL_FILE="$database_url_file" NODE_ENV=production \
            gosu rentnerproxy bun migrate.js
    )
}

start_web() {
    start_child web env \
        APP_ENCRYPTION_KEY_FILE="$app_key_file" \
        DATABASE_URL_FILE="$database_url_file" \
        HOST=0.0.0.0 \
        NODE_ENV=production \
        PORT=3000 \
        REDIS_URL=redis://127.0.0.1:6379 \
        RENTNERPROXY_CONTROLLER_TOKEN_FILE="$controller_token_file" \
        RENTNERPROXY_CONTROLLER_URL=http://127.0.0.1:8081 \
        RENTNERPROXY_TRUST_PROXY_HEADERS="${RENTNERPROXY_TRUST_PROXY_HEADERS:-false}" \
        gosu rentnerproxy bun "$app_directory/docker/web/serve.mjs"
}

monitor_children() {
    local status
    if wait -n "${child_pids[@]}"; then
        status=0
    else
        status=$?
    fi
    log "a supervised child exited unexpectedly (status $status)"
    exit 1
}

trap shutdown_children EXIT
trap on_shutdown_signal INT TERM

initialize_layout
initialize_secrets
initialize_postgres_data_directory
start_postgres
start_redis
start_controller
run_migrations
start_web
monitor_children

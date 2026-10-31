#!/usr/bin/env bash

# Local disposable fixtures only; never start databases, agents, or appliances.
set -Eeuo pipefail

readonly production_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly entrypoint="$production_directory/entrypoint.sh"
readonly backup_supervisor="$production_directory/backups/supervisor.sh"

load_function() {
    local file=$1 name=$2 definition
    definition=$(sed -n "/^$name() {$/,/^}$/p" "$file")
    [[ -n $definition ]] || { printf 'missing function: %s\n' "$name" >&2; exit 1; }
    source /dev/stdin <<< "$definition"
}

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
fatal() { printf '%s\n' "$*" >&2; exit 1; }
log() { :; }

test_identity() (
    local scratch identity field
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/rentnerproxy-backup-identities.XXXXXX")
    trap 'rm -rf -- "$scratch"' EXIT
    load_function "$backup_supervisor" backup_status_has_consumer_identity
    for identity in 0 10001 10002 10003 999; do
        for field in 1 2 3 4; do
            local -a identities=(0 0 0 0)
            identities[$((field - 1))]=$identity
            printf 'Name:\tfixture\nUid:\t%s\t%s\t%s\t%s\n' "${identities[@]}" > "$scratch/status"
            if backup_status_has_consumer_identity "$scratch/status"; then
                case $identity in 10001|10002|10003) ;; *) fail 'rejected a non-consumer identity' ;; esac
            else
                case $identity in 10001|10002|10003) fail 'missed a surviving consumer identity' ;; esac
            fi
        done
    done
    printf 'State:\tZ (zombie)\nUid:\t10001\t10001\t10001\t10001\n' > "$scratch/status"
    if backup_status_has_consumer_identity "$scratch/status"; then fail 'a reaped writer was mistaken for a live consumer'; fi
    printf 'PASS: surviving consumer identities are detected in every UID field\n'
)

test_maintenance() (
    local scratch scenario status
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/rentnerproxy-backup-maintenance.XXXXXX")
    trap 'rm -rf -- "$scratch"' EXIT
    for scenario in success execution_failed recovery_failed forced orphan interrupted; do
        mkdir "$scratch/$scenario"
        if (
            local backup_control_directory="$scratch/$scenario"
            local crowdsec_control_directory="$scratch/$scenario/crowdsec"
            local backup_exporter=dummy-exporter app_directory=dummy-app backup_recovery_job=''
            local fixture_request_id=12345678-1234-4234-8234-123456789abc
            declare -a child_pids=() child_names=()
            mkdir "$crowdsec_control_directory"
            printf '{"id":"%s"}\n' "$fixture_request_id" > "$backup_control_directory/request.json"
            load_function "$backup_supervisor" perform_managed_backup
            load_function "$backup_supervisor" backup_write_result
            load_function "$entrypoint" shutdown_children
            load_function "$entrypoint" on_shutdown_signal
            trap shutdown_children EXIT
            trap on_shutdown_signal TERM INT
            record() { printf '%s\n' "$*" >> "$backup_control_directory/events"; }
            bun() {
                case $3 in
                    --request-id) printf '%s\n' "$fixture_request_id" ;;
                    --result) record "result $4 $5" ;;
                    *) fail 'unexpected fixture command' ;;
                esac
            }
            backup_stop_consumer_phase() {
                record "drain $1"
                [[ $scenario != forced ]]
            }
            backup_assert_consumers_stopped() {
                record writer-check
                [[ $scenario != orphan ]] || fatal 'surviving writer fixture'
            }
            backup_assert_state_children_running() { record state-check; }
            backup_run_exporter() {
                record export
                [[ $scenario != interrupted ]] || on_shutdown_signal
                [[ $scenario != execution_failed ]]
            }
            start_crowdsec_supervisor() { record restart-crowdsec; }
            start_controller() {
                record restart-controller
                [[ $scenario != recovery_failed ]] || fatal 'failed recovery fixture'
            }
            start_web() { record restart-web; }
            wait_for_web_readiness() { record ready; }
            perform_managed_backup
            [[ ! -e $backup_control_directory/request.json && -f $backup_control_directory/active.json ]] \
                || fail 'request was not claimed'
            [[ -z $backup_recovery_job ]] || fail 'completed recovery retained a pending failure'
        ); then status=0; else status=$?; fi

        local events
        events=$(<"$scratch/$scenario/events")
        case $scenario in
            success|execution_failed)
                ((status == 0)) || fail "$scenario maintenance failed"
                [[ $events == "drain application
drain crowdsec
writer-check
export
state-check
restart-crowdsec
restart-controller
restart-web
ready
result 12345678-1234-4234-8234-123456789abc $scenario" ]] || fail "$scenario ordering or result changed"
                ;;
            recovery_failed)
                ((status != 0)) || fail 'failed recovery was accepted'
                [[ $events == *'result 12345678-1234-4234-8234-123456789abc recovery_failed'* ]] \
                    || fail 'recovery failure was not reported before shutdown'
                [[ $events != *restart-web* ]] || fail 'failed recovery continued startup'
                ;;
            forced|orphan)
                ((status != 0)) || fail "$scenario quiescing was accepted"
                [[ $events != *export* && $events != *restart-* && $events != *result* ]] \
                    || fail "$scenario quiescing executed backup or reported success"
                ;;
            interrupted)
                ((status == 0)) || fail 'shutdown signal exit failed'
                [[ $events != *restart-* && $events != *result* ]] || fail 'interrupted maintenance restarted consumers'
                ;;
        esac
    done
    printf 'PASS: maintenance ordering, failed export recovery, failed restart, forced/orphan rejection, interruption\n'
)

test_drain() (
    load_function "$backup_supervisor" backup_stop_consumer_phase
    local mode index
    for mode in graceful forced abnormal; do
        (
            declare -a child_pids=(101 102 103 104 105 106)
            declare -a child_names=(web postgres controller valkey crowdsec-supervisor backups)
            local signals='' SECONDS=0
            local -a alive=(101 102 103 104 105 106)
            backup_assert_state_children_running() { :; }
            sleep() { SECONDS=$((SECONDS + 1)); }
            kill() {
                local candidate
                if [[ $1 == -0 ]]; then
                    for candidate in "${alive[@]}"; do [[ $2 != "$candidate" ]] || return 0; done
                    return 1
                fi
                signals+="$1:$2 "
                if [[ $mode != forced || $1 == -KILL ]]; then
                    for candidate in "${!alive[@]}"; do
                        [[ ${alive[$candidate]} != "$2" ]] || unset "alive[$candidate]"
                    done
                fi
            }
            wait() { [[ $mode != abnormal ]]; }
            if backup_stop_consumer_phase application 3; then
                [[ $mode == graceful ]] || fail "$mode stop was accepted"
            else
                [[ $mode != graceful ]] || fail 'graceful drain was rejected'
            fi
            [[ $signals == *'-TERM:101 '* && $signals == *'-TERM:103 '* ]] || fail 'application TERM was incomplete'
            [[ $signals != *':102 '* && $signals != *':104 '* && $signals != *':105 '* && $signals != *':106 '* ]] \
                || fail 'application drain signalled a preserved service'
            [[ ${child_names[*]} == 'postgres valkey crowdsec-supervisor backups' ]] || fail 'stopped children were not removed'
            if [[ $mode == forced ]]; then
                ((SECONDS == 3)) || fail 'forced drain exceeded its budget'
                [[ $signals == *'-KILL:101 '* && $signals == *'-KILL:103 '* ]] || fail 'forced drain did not reap owned children'
            fi
        )
    done
    printf 'PASS: bounded consumer drain preserves state services and removes only reaped children\n'
)

test_export_interruption() (
    local scratch supervisor_pid attempt
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/rentnerproxy-backup-cancellation.XXXXXX")
    trap 'rm -rf -- "$scratch"' EXIT
    (
        declare -a child_pids=() child_names=()
        local backup_exporter=dummy-exporter backup_recovery_job=''
        load_function "$entrypoint" start_child
        load_function "$entrypoint" shutdown_children
        load_function "$entrypoint" on_shutdown_signal
        load_function "$backup_supervisor" backup_run_exporter
        trap shutdown_children EXIT
        trap on_shutdown_signal INT TERM
        backup_assert_state_children_running() { :; }
        timeout() {
            [[ $* == '--signal=TERM --kill-after=5s 660s bun --no-env-file dummy-exporter --run dummy-id' ]] \
                || fail 'export escaped the fixed command and timeout'
            exec bash -c '
                trap '\''touch "$1/exporter-stopped"; exit 0'\'' TERM
                touch "$1/exporter-ready"
                while :; do sleep 0.02; done
            ' fixture "$scratch"
        }
        backup_run_exporter dummy-id
        touch "$scratch/export-returned"
    ) &
    supervisor_pid=$!
    for attempt in $(seq 1 100); do
        [[ ! -e $scratch/exporter-ready ]] || break
        sleep 0.02
    done
    [[ -e $scratch/exporter-ready ]] || fail 'export fixture did not start'
    kill -TERM "$supervisor_pid"
    wait "$supervisor_pid" || fail 'export cancellation did not stop supervisor cleanly'
    [[ -e $scratch/exporter-stopped && ! -e $scratch/export-returned ]] \
        || fail 'SIGTERM did not cancel the owned exporter before returning'
    printf 'PASS: SIGTERM interrupts export polling and drains the owned exporter\n'
)

test_export_outcome() (
    local fixture_status
    load_function "$backup_supervisor" backup_run_exporter
    for fixture_status in 0 1 2 124 137 143; do
        if (
            declare -a child_pids=() child_names=()
            local backup_exporter=dummy-exporter status=0
            start_child() { child_pids+=(999); child_names+=(backup-export); }
            kill() { return 1; }
            wait() { return "$fixture_status"; }
            backup_assert_state_children_running() { :; }
            backup_run_exporter dummy-id || status=$?
            ((fixture_status < 2 && status == fixture_status)) || fail 'unsafe exporter termination returned to maintenance'
            [[ ${#child_pids[@]} == 0 ]] || fail 'exporter was not reaped and removed'
        ); then
            ((fixture_status < 2)) || fail 'unsafe exporter exit was accepted'
        else
            ((fixture_status >= 2)) || fail 'normal exporter exit was rejected'
        fi
    done
    printf 'PASS: exporter timeout and signal exits stop the appliance before consumer recovery\n'
)

test_process_guard() (
    [[ $(uname -s) == Linux && $(id -u) == 0 ]] \
        || { printf 'SKIP: process guard requires disposable Linux namespace root\n'; exit 77; }
    command -v setpriv >/dev/null && command -v setsid >/dev/null \
        || { printf 'SKIP: process guard requires setpriv and setsid\n'; exit 77; }
    local valkey_pid='' survivor_pid=''
    cleanup() {
        local owned_pid
        for owned_pid in "$valkey_pid" "$survivor_pid"; do
            [[ -z $owned_pid ]] || kill -KILL "$owned_pid" 2>/dev/null || true
            [[ -z $owned_pid ]] || wait "$owned_pid" 2>/dev/null || true
        done
    }
    trap cleanup EXIT
    load_function "$backup_supervisor" backup_status_has_consumer_identity
    load_function "$backup_supervisor" backup_assert_consumers_stopped
    load_function "$backup_supervisor" backup_assert_state_children_running
    setpriv --reuid=10001 --regid=10001 --clear-groups -- sleep 30 &
    valkey_pid=$!
    declare -a child_pids=("$valkey_pid") child_names=(valkey)
    backup_assert_consumers_stopped || fail 'the owned Valkey PID was not exempted'
    setsid setpriv --reuid=10001 --regid=10001 --clear-groups -- sleep 30 &
    survivor_pid=$!
    local attempt
    for attempt in $(seq 1 100); do
        if backup_status_has_consumer_identity "/proc/$survivor_pid/status"; then break; fi
        sleep 0.01
    done
    backup_status_has_consumer_identity "/proc/$survivor_pid/status" || fail 'survivor fixture did not drop identity'
    if (backup_assert_consumers_stopped); then fail 'an independent surviving consumer was accepted'; fi
    printf 'PASS: actual detached consumer identity blocks export while the owned Valkey PID is preserved\n'
)

test_startup_admission() (
    local scratch
    scratch=$(mktemp -d "${TMPDIR:-/tmp}/rentnerproxy-backup-startup.XXXXXX")
    trap 'rm -rf -- "$scratch"' EXIT
    (
        local backup_control_directory="$scratch" app_directory=dummy-app readiness_probes=0
        declare -a child_pids=() child_names=()
        load_function "$entrypoint" wait_for_command
        load_function "$entrypoint" wait_for_web_readiness
        load_function "$entrypoint" monitor_children
        load_function "$entrypoint" assert_children_running
        require_public_origin() { :; }
        initialize_layout() { :; }
        initialize_secrets() { :; }
        start_backup_agent() {
            # Catch-up is admitted before database and web startup complete.
            printf '{"id":"12345678-1234-4234-8234-123456789abc"}\n' > "$scratch/request.json"
        }
        start_crowdsec_supervisor() { :; }
        start_controller() { :; }
        initialize_postgres_data_directory() { :; }
        start_postgres() { :; }
        start_valkey() { :; }
        run_migrations() { :; }
        start_web() { touch "$scratch/web-started"; }
        timeout() {
            [[ $1 == --signal=TERM && $2 == --kill-after=1s && $3 == 5s ]] \
                || fail 'web readiness probe lost its timeout'
            shift 3
            "$@"
        }
        bun() {
            [[ $* == '--no-env-file dummy-app/docker/web/healthcheck.ts' ]] \
                || fail 'startup used a different readiness check'
            readiness_probes=$((readiness_probes + 1))
            ((readiness_probes >= 3)) || return 1
            touch "$scratch/web-ready"
        }
        sleep() { :; }
        perform_managed_backup() {
            [[ -e $scratch/web-started && -e $scratch/web-ready && $readiness_probes == 3 ]] \
                || fail 'queued maintenance entered before initial web readiness'
            touch "$scratch/maintenance-started"
            exit 0
        }
        # Execute the actual normal-startup dispatcher with isolated role stubs.
        source /dev/stdin <<< "$(sed -n '/^require_public_origin$/,$p' "$entrypoint")"
    )
    [[ -e $scratch/maintenance-started ]] || fail 'queued catch-up was not processed after readiness'
    printf 'PASS: queued catch-up waits for initial web readiness before maintenance admission\n'
)

if [[ ${1:-} == --linux-processes ]]; then
    test_process_guard
    exit
fi

test_identity
test_maintenance
test_drain
test_export_outcome
test_export_interruption
test_startup_admission

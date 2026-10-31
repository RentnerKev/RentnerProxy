#!/usr/bin/env bash

# Sourced by the root production supervisor, which retains all child ownership.
readonly backup_control_directory=/run/rentnerproxy/backups
readonly backup_exporter=/opt/rentnerproxy/web/backup-export.js
backup_recovery_job=''

start_backup_agent() {
    local lock_file=/run/rentnerproxy/backup-agent.lock
    if [[ -e $backup_control_directory || -L $backup_control_directory ]]; then
        [[ -d $backup_control_directory && ! -L $backup_control_directory ]] \
            || fatal 'the backup control directory is not a real directory'
        [[ $(stat -c '%u' -- "$backup_control_directory") == 0 ]] \
            || fatal 'the backup control directory is not root-owned'
    fi
    install -d -m 0750 -o root -g rentnerproxy "$backup_control_directory"
    if [[ -e $lock_file || -L $lock_file ]]; then
        [[ -f $lock_file && ! -L $lock_file ]] \
            || fatal 'the backup agent lock is not a regular file'
        [[ $(stat -c '%u:%h' -- "$lock_file") == 0:1 ]] \
            || fatal 'the backup agent lock has unsafe ownership or links'
    fi
    touch -- "$lock_file"
    chmod 0600 -- "$lock_file"
    # /run can survive a container stop/start. Do not accept an old socket as ready.
    rm -f -- "$backup_control_directory/agent.sock"
    start_child backups flock --no-fork -n "$lock_file" \
        bun --no-env-file "$app_directory/backup-agent.js"
    wait_for_command 'backup agent' test -S "$backup_control_directory/agent.sock"
}

backup_write_result() {
    bun --no-env-file "$backup_exporter" --result "$1" "$2"
}

backup_assert_state_children_running() {
    local index
    for index in "${!child_pids[@]}"; do
        case ${child_names[$index]} in backups|postgres|valkey) ;; *) continue ;; esac
        kill -0 "${child_pids[$index]}" 2>/dev/null \
            || fatal "${child_names[$index]} stopped during backup maintenance"
    done
}

backup_stop_consumer_phase() {
    local phase=$1 budget=$2 index pid deadline running status failed=false
    local -a stopping=()
    for index in "${!child_pids[@]}"; do
        case $phase:${child_names[$index]} in
            application:web|application:controller|crowdsec:crowdsec-supervisor) ;;
            *) continue ;;
        esac
        stopping+=("$index")
        pid=${child_pids[$index]}
        if ! kill -0 "$pid" 2>/dev/null || ! kill -TERM "$pid" 2>/dev/null; then
            failed=true
        fi
    done
    deadline=$((SECONDS + budget))
    while ((SECONDS < deadline)); do
        backup_assert_state_children_running
        running=false
        for index in "${stopping[@]}"; do
            if kill -0 "${child_pids[$index]}" 2>/dev/null; then
                running=true
                break
            fi
        done
        "$running" || break
        sleep 0.1
    done
    for index in "${stopping[@]}"; do
        pid=${child_pids[$index]}
        if kill -0 "$pid" 2>/dev/null; then
            log "${child_names[$index]} did not drain for backup maintenance"
            kill -KILL "$pid" 2>/dev/null || true
            failed=true
        fi
        if wait "$pid"; then
            :
        else
            status=$?
            log "${child_names[$index]} exited with status $status during backup drain"
            failed=true
        fi
        unset "child_pids[$index]" "child_names[$index]"
    done
    [[ $failed == false ]]
}

backup_status_has_consumer_identity() {
    local status_file=$1 field real effective saved filesystem remainder
    while read -r field real effective saved filesystem remainder; do
        if [[ $field == State: && ( $real == Z || $real == X ) ]]; then return 1; fi
        [[ $field == Uid: ]] || continue
        case " $real $effective $saved $filesystem " in
            *' 10001 '*|*' 10002 '*|*' 10003 '*) return 0 ;;
            *) return 1 ;;
        esac
    done < "$status_file"
    return 1
}

backup_assert_consumers_stopped() {
    local index valkey_pid='' status_file pid
    [[ -r /proc/self/status ]] || fatal 'backup maintenance requires process identity visibility'
    for index in "${!child_pids[@]}"; do
        if [[ ${child_names[$index]} == valkey ]]; then valkey_pid=${child_pids[$index]}; fi
    done
    [[ -n $valkey_pid ]] || fatal 'backup maintenance has no owned Valkey process'
    # Caddy deliberately starts a separate process group. Inspect identities,
    # rather than trusting a consumer-writable PID file or killing by a name.
    for status_file in /proc/[0-9]*/status; do
        pid=${status_file#/proc/}
        pid=${pid%/status}
        [[ $pid != "$valkey_pid" ]] || continue
        [[ -r $status_file ]] || continue
        if backup_status_has_consumer_identity "$status_file" 2>/dev/null; then
            fatal 'an application or CrowdSec process survived backup quiescing'
        fi
    done
    backup_assert_state_children_running
}

backup_run_exporter() {
    local id=$1 index pid status=0
    start_child backup-export timeout --signal=TERM --kill-after=5s 660s \
        bun --no-env-file "$backup_exporter" --run "$id"
    # Consumer removal leaves sparse arrays; locate the new child by its role.
    for index in "${!child_pids[@]}"; do
        [[ ${child_names[$index]} == backup-export ]] && break
    done
    pid=${child_pids[$index]}
    while kill -0 "$pid" 2>/dev/null; do
        backup_assert_state_children_running
        sleep 0.2
    done
    wait "$pid" || status=$?
    unset "child_pids[$index]" "child_names[$index]"
    # A killed runtime cannot prove its detached capture commands were reaped.
    # End the appliance instead of restarting writers beside an orphaned capture.
    if ((status == 2 || status == 124 || status >= 128)); then
        fatal 'backup exporter could not prove safe completion'
    fi
    return "$status"
}

perform_managed_backup() {
    local id outcome=success
    [[ ! -e $backup_control_directory/active.json && ! -L $backup_control_directory/active.json ]] \
        || fatal 'a backup maintenance request is already active'
    mv -T -- "$backup_control_directory/request.json" "$backup_control_directory/active.json"
    id=$(bun --no-env-file "$backup_exporter" --request-id) \
        || fatal 'invalid backup maintenance request'
    log "starting managed backup maintenance ($id)"
    # Preserve state services and CrowdSec while application consumers drain.
    backup_stop_consumer_phase application 23 \
        || fatal 'application consumers could not quiesce safely for backup'
    # An in-flight cscli call has a 25s bound; the engine then gets 12s to stop.
    backup_stop_consumer_phase crowdsec 40 \
        || fatal 'CrowdSec could not quiesce safely for backup'
    backup_assert_consumers_stopped
    if ! backup_run_exporter "$id"; then outcome=execution_failed; fi
    backup_assert_state_children_running

    # The EXIT trap records recovery_failed before state services/agent stop.
    backup_recovery_job=$id
    rm -f -- "$crowdsec_control_directory/status.json"
    start_crowdsec_supervisor
    start_controller
    start_web
    wait_for_web_readiness
    backup_write_result "$id" "$outcome"
    backup_recovery_job=''
    log "managed backup maintenance completed ($id, $outcome)"
}

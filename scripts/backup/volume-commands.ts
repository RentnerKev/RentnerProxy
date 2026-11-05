import { postgresShutdownScript } from './postgres-shutdown.ts'
import { stateArchiveExclusions } from './controller-state-archive.ts'

export function postgresRestoreCommand(validateOnly: boolean, backupDirectory = '/backup'): string {
    if (!/^\/[A-Za-z0-9_./-]+$/u.test(backupDirectory))
        throw new Error('invalid backup snapshot path')
    return [
        'restore_phase=archive',
        'restore_directory=$(mktemp -d /tmp/rentnerproxy-restore.XXXXXX)',
        'chown postgres:postgres "$restore_directory"',
        'rendered_sql_path="$restore_directory/rendered.sql"',
        'restore_sql_path="$restore_directory/restore.sql"',
        'touch "$rendered_sql_path" "$restore_sql_path"',
        'chown postgres:postgres "$rendered_sql_path" "$restore_sql_path"',
        'chmod 0600 "$rendered_sql_path" "$restore_sql_path"',
        'restore_phase=render',
        'gosu postgres pg_restore --exit-on-error --no-owner --no-acl --clean --if-exists --file="$rendered_sql_path" < ' +
            backupDirectory +
            '/postgres.dump',
        'restore_phase=assemble',
        '{ printf "%s\\n" "DROP SCHEMA IF EXISTS rentnerproxy CASCADE;" "DROP SCHEMA IF EXISTS drizzle CASCADE;"; cat "$rendered_sql_path"; } > "$restore_sql_path"',
        ...(validateOnly
            ? []
            : [
                  'cat >> "$restore_sql_path" <<\'RESTORE_NOTIFICATION_SQL\'',
                  'WITH normalized AS MATERIALIZED (',
                  "    SELECT id, CASE jsonb_typeof(value) WHEN 'string' THEN (value #>> '{}')::jsonb ELSE value END AS value",
                  "    FROM rentnerproxy.system_settings WHERE key = 'notification_configuration_v1'",
                  ')',
                  "UPDATE rentnerproxy.system_settings AS settings SET value = jsonb_set(jsonb_set(jsonb_set(normalized.value, '{enabled}', 'false'::jsonb), '{pausedAfterRestore}', 'true'::jsonb), '{revision}', to_jsonb(least((normalized.value->>'revision')::bigint + 1, 4294967295))) FROM normalized WHERE settings.id = normalized.id;",
                  "DELETE FROM rentnerproxy.system_settings WHERE key = 'notification_delivery_state_v1';",
                  // The volume's root journal survives a database restore; explicitly rebase its rewound consumer once.
                  'INSERT INTO rentnerproxy.system_settings(key, value) VALUES (\'managed_backup_audit_cursor_v1\', \'{"storeId":null,"sequence":0,"restorePending":true}\'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();',
                  'RESTORE_NOTIFICATION_SQL',
              ]),
        'restore_phase=execute',
        'gosu postgres psql --host="$socket_directory" --single-transaction --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate --no-psqlrc --username=postgres --dbname=rentnerproxy --file="$restore_sql_path"',
    ].join('\n')
}

export function postgresCommand(validateOnly: boolean, backupDirectory = '/backup'): string {
    return [
        'set -Eeuo pipefail',
        'umask 077',
        'restore_phase=initialize',
        'trap \'status=$?; printf "RESTORE_PHASE=%s\\n" "$restore_phase" >&2; exit "$status"\' ERR',
        'restore_directory=""; rendered_sql_path=""; restore_sql_path=""',
        validateOnly
            ? 'data_directory=/tmp/backup-postgres; socket_directory=/tmp/backup-postgres-socket'
            : 'data_directory=/var/lib/rentnerproxy/postgres-data; socket_directory=/var/run/postgresql',
        'install -d -m 0700 -o postgres -g postgres "$socket_directory"',
        ...(validateOnly
            ? [
                  'install -d -m 0700 -o postgres -g postgres "$data_directory"',
                  'gosu postgres initdb --auth=trust --username=postgres -D "$data_directory" >&2',
              ]
            : ['test -s "$data_directory/PG_VERSION"']),
        'gosu postgres postgres -D "$data_directory" -c listen_addresses=' +
            (validateOnly ? '127.0.0.1' : '') +
            ' -c unix_socket_directories="$socket_directory" >&2 & postgres_pid=$!',
        postgresShutdownScript(),
        'cleanup() { rm -f -- "$rendered_sql_path" "$restore_sql_path"; rmdir -- "$restore_directory" 2>/dev/null || true; stop_postgres; }',
        'trap cleanup EXIT',
        'ready=false',
        'for attempt in $(seq 1 60); do if gosu postgres pg_isready --host="$socket_directory" --username=postgres >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done',
        '"$ready"',
        ...(validateOnly
            ? ['gosu postgres createdb --host="$socket_directory" --username=postgres rentnerproxy']
            : []),
        validateOnly
            ? postgresRestoreCommand(true, backupDirectory)
            : postgresRestoreCommand(false, backupDirectory).replace(
                  '--username=postgres --dbname=rentnerproxy',
                  '--username=rentnerproxy --dbname=rentnerproxy',
              ),
        ...(validateOnly ? ['bun /opt/rentnerproxy/web/docker/web/validate-backup.ts'] : []),
    ].join('\n')
}

export function controllerRestoreCommand(): string {
    const exclusions = stateArchiveExclusions.map((entry) => '--exclude=' + entry).join(' ')
    return [
        'set -Eeuo pipefail',
        'umask 077',
        'root=/var/lib/rentnerproxy',
        'test ! -L "$root/proxy"',
        'rm -rf -- "$root/.restore-proxy"',
        'install -d -m 0700 -o rentnerproxy -g rentnerproxy "$root/.restore-proxy"',
        'tar --extract --no-same-owner --no-same-permissions ' +
            exclusions +
            ' --file=/backup/controller-state.tar --directory="$root/.restore-proxy"',
        'printf %s "Restore requires explicit DDNS activation" > "$root/.restore-proxy/ddns-restore-paused"',
        'printf %s "Restore requires explicit Docker discovery activation" > "$root/.restore-proxy/docker-discovery-restore-paused"',
        'find "$root/.restore-proxy" -type d -exec chmod 0700 {} +',
        'find "$root/.restore-proxy" -type f -exec chmod 0600 {} +',
        'chown -R rentnerproxy:rentnerproxy "$root/.restore-proxy"',
        'rm -rf -- "$root/proxy"',
        'mv -T -- "$root/.restore-proxy" "$root/proxy"',
    ].join('\n')
}

export function crowdSecRestoreCommand(): string {
    return [
        'set -Eeuo pipefail',
        'umask 077',
        'root=/var/lib/rentnerproxy',
        'test ! -L "$root/crowdsec"',
        'rm -rf -- "$root/.restore-crowdsec"',
        'mkdir -m 0700 "$root/.restore-crowdsec"',
        'tar --extract --no-same-owner --no-same-permissions --file=/backup/crowdsec-state.tar --directory="$root/.restore-crowdsec"',
        'find "$root/.restore-crowdsec" -type d -exec chmod 0700 {} +',
        'find "$root/.restore-crowdsec" -type f -exec chmod 0600 {} +',
        'chown -R crowdsec:crowdsec "$root/.restore-crowdsec"',
        'install -d -m 0700 -o crowdsec -g crowdsec "$root/.restore-crowdsec/data" "$root/.restore-crowdsec/credentials"',
        'install -d -m 0710 -o root -g rentnerproxy "$root/.restore-crowdsec/bouncer"',
        'if [ -f "$root/.restore-crowdsec/bouncer/caddy-bouncer-key" ]; then chown root:rentnerproxy "$root/.restore-crowdsec/bouncer/caddy-bouncer-key"; chmod 0440 "$root/.restore-crowdsec/bouncer/caddy-bouncer-key"; fi',
        'chmod 0711 "$root/.restore-crowdsec"',
        'rm -rf -- "$root/crowdsec"',
        'mv -T -- "$root/.restore-crowdsec" "$root/crowdsec"',
    ].join('\n')
}

export function postgresDumpCommand(): string {
    return (
        'set -Eeuo pipefail; ' +
        postgresShutdownScript() +
        '; test -s /var/lib/rentnerproxy/postgres-data/PG_VERSION; install -d -m 0700 -o postgres -g postgres /var/run/postgresql; chmod 00700 /var/run/postgresql; gosu postgres postgres -D /var/lib/rentnerproxy/postgres-data -c listen_addresses= -c unix_socket_directories=/var/run/postgresql >&2 & postgres_pid=$!; cleanup() { stop_postgres; }; trap cleanup EXIT; ready=false; for attempt in $(seq 1 60); do if gosu postgres pg_isready --host=/var/run/postgresql --username=' +
        'rentnerproxy' +
        ' --dbname=' +
        'rentnerproxy' +
        ' >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done; "$ready"; gosu postgres pg_dump --host=/var/run/postgresql --format=custom --no-owner --no-acl --username=' +
        'rentnerproxy' +
        ' --dbname=' +
        'rentnerproxy'
    )
}

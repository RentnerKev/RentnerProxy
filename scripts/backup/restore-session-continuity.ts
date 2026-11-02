import { z } from 'zod'

const preservedSessionSchema = z
    .object({
        id: z.uuid(),
        user_id: z.uuid(),
        token_hash: z.string().regex(/^[a-f0-9]{64}$/u),
        created_at: z.iso.datetime({ offset: true }),
        last_seen_at: z.iso.datetime({ offset: true }),
        reauthenticated_at: z.iso.datetime({ offset: true }),
        expires_at: z.iso.datetime({ offset: true }),
    })
    .strict()

// Capture only current authentication, never anything from the restored archive.
export const captureRestoreSessionsSql = `
SELECT coalesce(jsonb_agg(to_jsonb(current_session)), '[]'::jsonb)::text
FROM (
    SELECT s.id, s.user_id, s.token_hash, s.created_at, s.last_seen_at,
           s.reauthenticated_at, s.expires_at
    FROM rentnerproxy.sessions s
    JOIN rentnerproxy.users u ON u.id = s.user_id
    WHERE u.status = 'active' AND s.expires_at > now()
      AND (to_jsonb(s)->>'oidc_proof') IS NULL
      AND (to_jsonb(u)->>'oidc_provider_id') IS NULL
    ORDER BY s.id
    LIMIT 10001
) current_session;
`

export function mergeRestoreSessionsSql(snapshot: string): string {
    if (Buffer.byteLength(snapshot, 'utf8') > 16 * 1024 * 1024)
        throw new Error('Restore session snapshot exceeds its limit')
    const sessions = z.array(preservedSessionSchema).max(10_000).parse(JSON.parse(snapshot))
    if (
        new Set(sessions.map((session) => session.id)).size !== sessions.length ||
        new Set(sessions.map((session) => session.token_hash)).size !== sessions.length
    )
        throw new Error('Restore session snapshot contains duplicate sessions')
    const json = JSON.stringify(sessions).replaceAll("'", "''")
    // Recompute authorization through the normal service on the next request.
    // Deleting first prevents old, revoked backup sessions from being resurrected.
    return `
BEGIN;
DELETE FROM rentnerproxy.sessions;
INSERT INTO rentnerproxy.sessions
    (id, user_id, token_hash, created_at, last_seen_at, reauthenticated_at, expires_at)
SELECT s.id, s.user_id, s.token_hash, s.created_at, s.last_seen_at,
       s.reauthenticated_at, s.expires_at
FROM jsonb_to_recordset('${json}'::jsonb) AS s(
    id uuid, user_id uuid, token_hash varchar(64), created_at timestamptz,
    last_seen_at timestamptz, reauthenticated_at timestamptz, expires_at timestamptz
)
JOIN rentnerproxy.users u ON u.id = s.user_id
WHERE u.status = 'active' AND s.expires_at > now()
  AND (to_jsonb(u)->>'oidc_provider_id') IS NULL;
DO $restore_session_proof$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'rentnerproxy.sessions'::regclass
          AND attname = 'oidc_proof' AND NOT attisdropped
    ) THEN
        EXECUTE 'UPDATE rentnerproxy.sessions SET oidc_proof = NULL';
    END IF;
END;
$restore_session_proof$;
COMMIT;
`
}

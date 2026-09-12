# Administrative audit log

Open **Audit Log** to review management activity. Owners and administrators can view it by
default; custom roles need `audit-logs:view`. Filter by actor ID, action, resource or UTC
date/time range, then page through results from newest to oldest. Refresh starts a new view.

Events contain a timestamp, actor, action, target type and ID, result and selected metadata.
The viewer has no editing or deletion actions. Historical actor IDs remain when accounts
are deleted; a display name is shown only while the account still exists.

The trail covers completed sign-ins and sign-outs, authentication failures, password resets
and changes, MFA and passkey changes, invitations, users and roles, hosts, access policies,
certificates, Trusted CAs and proxy settings. Issuing an MFA challenge is not a completed login.
A saved configuration and its runtime apply outcome are separate events; pending activation
does not claim that traffic already uses the change.

Successful database mutations and their audit entries commit together. Rejected operations
are recorded after rollback on a best-effort basis, preserving the original error if the
database is unavailable. Submitted passwords, tokens, recovery codes, keys, provider
credentials, raw errors and request payloads are never accepted as audit metadata.
Requests rejected by the rate limiter do not trigger additional audit database writes.

Events live in PostgreSQL and are included in database backups. On writes and viewer reads,
retention removes records older than 90 days and retains at most the newest 100,000 events.
An idle instance performs that cleanup at its next write or read. Pages contain at most
100 events and use timestamp/ID cursors so new activity does not shift existing pages.

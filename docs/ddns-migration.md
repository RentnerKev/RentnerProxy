# Move from a Cloudflare DDNS container to RentnerProxy

The DDNS page at `/ddns` requires `ddns.view`; changes require `ddns.manage`.
Choosing another shared connection also requires `dns_connections.view`. The page
uses the controller's public IPv4/IPv6 connectivity, including during native Windows
development. Saving active records can perform real DNS writes. Automated UI and
provider fixtures use synthetic domains and never contact a real Cloudflare account.

## Configure the exact update scope

1. Create a connection under **DNS connections** and select its permitted zones.
   The token needs Zone Read and DNS Edit. The connection test checks read access;
   it does not prove write access.
2. Stop the former updater for these records before saving the first active DDNS
   list. For the example Compose service: `docker compose stop cloudflare-ddns`.
   Keep its configuration for rollback.
3. Open **Settings** on the DDNS page. Choose an interval, enabled address families
   and whether to update when the controller starts. `300` means every five minutes;
   valid intervals are 60–86400 whole seconds.
4. Choose **Add records**, a connection and an explicit zone or **Match permitted
   zones automatically**. Enter one hostname per input. Enter or **Add another
   domain** adds the next input. Choose A, AAAA or both, the Cloudflare proxy flag
   and whether those records should receive updates.
5. **Save changes** automatically inspects newly managed or reactivated records,
   binds existing Cloudflare record IDs or approves creation of absent records,
   and rechecks the result before saving the configuration atomically. Conflicts,
   unavailable IP discovery and permission failures produce a toast and retain
   the open draft. No manual preview or approval panel is needed.

On a fresh configuration, saving active records starts DDNS. An explicitly paused
configuration stays paused while its list is edited; **Enable DDNS** checks the
saved scope automatically and resumes it. Restore-paused instances likewise require
explicit enabling. Interval-only edits, disabling and removal do not require a
working Cloudflare provider. An admitted controller batch can temporarily block edits.

The shared record table supports search, sorting, pagination and per-row **Edit**,
**Enable**, **Disable** and **Delete** actions. Disabled records retain their last
good values and connection references across restarts. Disabling every record
retains the global enable setting, so enabling one row can resume its schedule.
Deleting a managed row stops its updates; it does not delete its Cloudflare DNS
record. A different hostname/type/zone/connection receives a fresh managed identity.

## Map the existing Compose settings

| Existing setting                  | RentnerProxy equivalent                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`            | Encrypted shared DNS connection and permitted zones.                                 |
| `DOMAINS`                         | Individual inputs containing the exact apex, wildcard and subdomain names to manage. |
| `PROXIED: "!is(git.example.com)"` | Edit `git.example.com` and turn Cloudflare proxy off for that row.                   |
| `IP6_PROVIDER: none`              | Leave IPv6 disabled in Settings and add A records.                                   |
| `UPDATE_CRON: "@every 5m"`        | Interval `300`. Arbitrary cron expressions are not imported.                         |
| `UPDATE_ON_START: "true"`         | Enable Update when controller starts. Existing backoff still applies.                |
| `TZ`, `QUIET`, `EMOJI`            | No import needed; status timestamps are shown in UTC.                                |

For example, add `example.com`, `*.example.com`, `example.org`, `*.example.org`
and `git.example.com` as separate A-record inputs. Then edit the Git row's proxy
flag. This selects five exact records across two permitted zones.

**The record list is an allowlist.** Selecting a zone never selects all its records.
`*.example.com` is one literal wildcard DNS record; it does not select existing named
subdomains. Leave `test.example.com` out to keep its A record on a different address.
A concrete subdomain record takes precedence over a wildcard in DNS resolution.
TXT, MX and other unlisted types remain untouched. Fixed per-host destination IPs
are configured directly in Cloudflare outside this DDNS list.

A/AAAA selection and the global IPv4/IPv6 settings are independent: adding an AAAA
row while IPv6 is disabled keeps it paused until IPv6 is enabled in Settings.

## Observe operation and recover

DDNS and connection metadata use authenticated WebSocket revision notifications,
including resynchronization after reconnect. There are no reload buttons or browser
polling timers. Background updates preserve open drafts; a changed configuration
revision blocks stale saving and asks through a toast to reopen the editor.

Each row shows its last confirmed IP, result, last success and next attempt.
Failures keep last-good values. **Update now** uses the same concurrency gate,
provider cooldowns and persisted retry floors as scheduled updates. Errors and
confirmation feedback appear as toasts. If status becomes unavailable, known values
remain visible and mutations are disabled until the next successful live refresh.

Permanent permission, ownership or conflict errors need a configuration or
connection repair. If a provider record was replaced, delete its managed DDNS row
and add it again to inspect the new identity. Do not blindly repeat a timed-out
write: observe the confirmed status first.

To roll back, **Pause DDNS**, wait for any admitted batch to finish, check the DNS
values and restart the former updater with `docker compose start cloudflare-ddns`.
Keep one writer per record. Pausing/removal retains Cloudflare records and ownership
comments. Backups include DDNS state; supported restores keep it paused until explicit
enabling. See [durable automation](ddns-automation.md) for controller API and recovery.

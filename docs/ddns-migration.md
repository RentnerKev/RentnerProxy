# Move from a Cloudflare DDNS container to RentnerProxy

The DDNS page is available at `/ddns` under Operations. An owner or administrator
can manage it; custom roles need `ddns.view` and `ddns.manage`. Choosing a new
shared connection also needs `dns_connections.view`. A read-only role needs only
`ddns.view` to inspect the saved configuration and runtime status.

This workflow configures the controller on the server where RentnerProxy runs. IP
discovery uses that controller's public IPv4/IPv6 connectivity. Native Windows
development can render the page without Caddy. Preview still contacts Cloudflare
and IP discovery; activation can perform real DNS writes, including in development.
Use a separate test zone for a live development check. The automated fixtures use
synthetic domains and no live Cloudflare calls.

## Map an existing favonia configuration

Use the settings in your existing Compose file as a checklist. RentnerProxy does
not parse Compose files, import `.env` files or display tokens in this page. See
the [favonia configuration reference](https://github.com/favonia/cloudflare-ddns)
for the original updater's settings.

| Existing setting                  | RentnerProxy equivalent                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`            | Save the token in a shared **DNS connection**, with the required zones permitted. Select that connection on the DDNS page.                       |
| `DOMAINS`                         | Paste the exact names, separated by commas or lines, into **Domains to manage**. Select automatic permitted-zone matching for a multi-zone list. |
| `PROXIED: "!is(git.example.com)"` | Leave **Cloudflare proxy** on for the selected records, then turn it off specifically for `git.example.com`. Each A/AAAA row has its own flag.   |
| `IP6_PROVIDER: none`              | Enable **IPv4 · A records**, leave **IPv6 · AAAA records** off. Existing AAAA records are untouched.                                             |
| `UPDATE_CRON: "@every 5m"`        | Set **Interval in seconds** to `300`. Intervals from 60 to 86400 whole seconds are supported; arbitrary cron expressions are not imported.       |
| `UPDATE_ON_START: "true"`         | Enable **Update when controller starts**. Activation also makes healthy records due promptly; persisted backoff still applies.                   |
| `TZ`, `QUIET`, `EMOJI`            | Scheduling is interval based. Status timestamps are labeled UTC; these logging and timezone variables do not need importing.                     |

For example, add `example.com, *.example.com, example.org, *.example.org,
git.example.com` with IPv4 on and IPv6 off. This makes five A-record rows across
two permitted zones. Turn the Git row's proxy flag off to reproduce the exception.

**The record list is an allowlist.** Selecting a zone does not select all of its
records. `*.example.com` denotes one literal wildcard DNS record; it does not select
or update existing named subdomains. Leave `test.example.com` out to keep its own
A record on another address. A concrete subdomain record also takes precedence over
a wildcard in DNS resolution. TXT, MX and other unlisted record types are not
managed. No exclusion expression is needed for names that are absent from the list.

All selected A records use the controller's discovered public IPv4; selected AAAA
records use its discovered public IPv6. Fixed arbitrary per-host destination IPs
are not part of this DDNS configuration: keep those records outside the list and
manage them in Cloudflare. Proxy settings apply per row, not per zone.

## Review before handing over

1. Create or check the shared connection in **DNS connections**. Its token must
   have Zone Read and DNS Edit for the permitted zones. A connection test can
   inspect zones but cannot prove write access without writing a record.
2. In **DDNS**, choose **Configure DDNS** or **Edit configuration**. Set the interval,
   enabled address families and update-on-start option. Choose the connection and
   zone matching, paste the exact names, then choose **Add to record list**. Review
   every A/AAAA row and set its proxy flag. Names may come from multiple connections.
3. Choose **Preview changes**. This is read-only: it shows current IP/proxy values,
   the desired IP, and whether each record exists, is missing or conflicts.
   Resolve duplicates, conflicting CNAMEs, missing permissions or a failed IP
   discovery before proceeding.
4. Choose **Approve inspected records** only after reviewing the comparison.
   Existing records are bound to their exact inspected Cloudflare IDs; missing
   records are explicitly allowed to be created. This requests a second preview.
5. Choose **Save paused** and confirm. Saving also pauses a previously active
   configuration. The confirmation counts removed targets. Removing a target stops
   future management but does not delete or restore its DNS record in Cloudflare.
6. **Stop the old DDNS updater before enabling RentnerProxy.** For the Compose
   service named in the example, run `docker compose stop cloudflare-ddns` in the
   directory containing that Compose project. Keep its configuration for rollback.
   Also stop any router, cron job or second instance managing the same records.
7. Preview the **saved** configuration again, choose **Enable DDNS**, and confirm
   the IP/proxy changes and that the previous updater has stopped. Activation is a
   separate step. It permits real DNS writes; with update-on-start off the initial
   scheduled run waits one interval. **Update now** is available once enabled.

A preview approval expires after three minutes and is bound to the authenticated
user, operation, exact settings and configuration revision. Editing a name, flag,
interval or address family invalidates it. Concurrent edits require canceling the
draft and reloading the saved configuration. Background status refreshes preserve
the open draft rather than replacing it silently.

To add AAAA rows later, temporarily select only IPv6 while adding the intended names,
then re-enable IPv4 before the new preview. This avoids adding duplicate A rows.
Turning a family off keeps its existing rows paused. The preview explicitly labels
those rows as skipped; enabling that family later requires another review.

## Verify operation and recover safely

The page refreshes status every ten seconds, or more frequently while a batch is
running. Each target shows its last confirmed IP/proxy value, last attempt, last
success and next attempt. Unchanged records count as successful checks. Partial
failures retain last-good values and show the specific failed targets. A failed
status refresh leaves previous values visible with an unavailable warning and
disables mutation controls until status is available again.

**Update now** shares the controller's scheduling and concurrency gate. It does
not bypass Cloudflare Retry-After, transient backoff or the manual-update floor.
Permanent permission, ownership or conflict errors need a configuration/connection
repair. For a replaced record, remove its DDNS target, add it again and inspect
before approving the new identity. A timeout can leave an accepted write without
confirmation: refresh and inspect before repeating an operation.

To roll back, choose **Pause DDNS** and confirm. A batch already admitted may still
finish; wait for it to leave the running state. Check the resulting DNS records,
then restart the former Compose updater with `docker compose start cloudflare-ddns`.
Never leave both writers active for the same records. Pausing/removing DDNS does
not undo changes to IPs or proxy flags, remove controller ownership comments, or
delete DNS records. Restore any desired values manually in Cloudflare as needed.

Full backups include controller DDNS configuration, status and shared connections.
Supported restores force DDNS to remain paused until explicitly reviewed and
enabled on the restored instance. See [durable automation](ddns-automation.md) for
restore markers, interrupted-run recovery and private controller API details.

DDNS does not configure port forwarding, bypass CGNAT, create a Cloudflare Tunnel,
open firewall ports or issue TLS certificates. Configure those parts separately
for the services that should be reachable.

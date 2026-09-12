# Proxy access logs

Open **Proxy Access Logs** to view recent requests, filter by host or HTTP status,
and search request details. Refresh returns to the newest page. Viewing logs requires
the dedicated permission; owners and administrators have it by default.

Entries include the timestamp, host, method, path, status, duration, client IP,
response bytes, protocol, and selected upstream when available. The client IP is
the direct connection peer. Behind another proxy, it is that proxy's address.

Caddy writes structured files inside the persistent proxy volume. The active file
rotates at 4 MiB, with up to four archives and seven days of archive retention.
Archive cleanup runs during rotation; files may contain older records until then.
The viewer shows at most seven days; busy installations may retain less because
of the size limit. Each query examines up to 4 MiB of the newest records and
10,000 entries. Filters and page counts apply to that recent window. Refreshing
loads the current window; requests arriving during pagination can shift rows.

Logs survive application restarts. They are deliberately excluded from production
backups, so restoring a backup does not restore request history.

Request and response headers, query strings, bodies, and authenticated usernames
are excluded from access logs. Paths themselves are visible: applications should
avoid placing credentials in path segments.

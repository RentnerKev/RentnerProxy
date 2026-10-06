# Runtime support report, format 1

Administrators with all three existing read permissions (`proxy_hosts.view`,
`redirect_hosts.view`, `certificates.view`) can download a JSON support report from
Proxy Hosts. The server checks these permissions before reading any source; hiding
the button is only a UI convenience. The report is created on explicit activation,
downloaded locally, and never uploaded automatically. Review it before attaching
it to an issue.

The allowlist consists of the format/version and capture time, application and
controller versions, configured Caddy binary version, component availability,
desired/applied SHA-256 revisions, last activation time, proxy/redirect host counts
and enabled counts, stored certificate status/operation/stage counts, certificate
binding job stage counts, and counters for known certificate/job error codes.
Unknown codes contribute only to the fixed `other` bucket. No source object is
serialized or redacted after the fact: the report constructs fresh fields. Every
source remains untrusted, including responses from existing status readers.

There are no domains, upstreams, entity/user/job IDs, headers, credentials, keys,
environment values, configuration JSON, audit events, logs, dumps or arbitrary
files. Version strings accept only bounded numeric releases and known
dev/alpha/beta/rc/preview qualifiers; custom version text is unavailable rather
than copied into the report because private deployment names can appear in custom
prerelease or build text. Counters must be safe integers between zero and one
billion, internally consistent with their total. Invalid data makes its section
unavailable. The serialized file is limited to 64 KiB.

`completeness: partial`, `unavailableSections`, nullable metadata, and each aggregate
section's availability mark observations that could not be read. Unavailable
counts are `null`, never invented zeroes. `runtime.state: pending` means the
observed desired revision is not active yet; it does not itself make a fully
observed report partial. Certificate counts describe the last stored controller
observations and do not refresh or mutate certificate state. Capture time is the
start of collection; independently read sections are not one atomic snapshot.

The private controller endpoint `/internal/v1/proxy/version` runs only
[`caddy version`](https://caddyserver.com/docs/command-line#caddy-version) against
the configured binary. It does not inspect the running process's executable,
modules, environment or configuration. The command clears its inherited environment
(Windows retains only `SystemRoot`), has null stdin/stderr, a one-second timeout and
a 1024-byte stdout limit, and returns only a bounded semantic version token after
discarding SemVer build metadata and trailing Caddy build information. Results,
including unavailable results, are cached for 60 seconds; simultaneous requests
admit only one probe without queuing behind it. Its separate cache and admission
locks do not block normal runtime status requests. Older
controllers without the endpoint, development builds without a recognizable
version, and missing binaries produce explicit unavailable metadata. They do not
break export of the remaining sections.

Both the browser endpoint and private controller response prohibit caching.
Controller calls reuse existing bounded transport. Aggregate and desired-revision
reads use read-only transactions with a two-second PostgreSQL statement timeout;
this is per statement, not an end-to-end two-second export guarantee. Source
failures become fixed unavailable markers without their messages or payloads.

Future additions require an explicit format/allowlist review and privacy tests.
This feature supplies the contract for beta security review #72 and UX review #74;
those release reviews remain separate work before #75.

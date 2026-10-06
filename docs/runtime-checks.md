# Runtime checks

## Proxy scale and concurrency checks

With the same Docker/Bun prerequisites as the reliability fixture, run:

```bash
bun run runtime:scale -- --hosts 100 --concurrency 4 --rounds 3 --seed 70 --report ./runtime-scale.json
```

The isolated fixture builds committed `HEAD` and bundles services from that exact revision. A supplied
`--image` must carry the matching OCI revision. It grows from 25 to 100 proxy hosts, with two domains
per host, 25 redirects, ten policies, ten wildcard-certificate bindings and a trusted upstream CA.
Each seeded round changes upstreams, disables/enables hosts and updates redirects while management
reads and HTTP traffic continue. Independent patches to the same policy must both survive. Final
persisted fields, IDs, domains, assignments, desired revision, active controller revision, Caddy JSON
and every route are checked. The feature phase also exercises Basic/IP policies, managed CrowdSec,
Forward Auth with combined IP restrictions, TLS/HTTP3, ACME issuance/renewal
and a durable certificate-binding retry, plus a
20-row NPM import and identical-source retry. An unavailable Caddy Admin socket must preserve the
last verified routes on a failed apply. The fixture briefly pauses its own web process to prevent
automatic background retries from racing that checkpoint. For this one fault probe the fixture
stops its own reconciler before mutation, asserts a pending response and makes one explicit apply
through the normal controller client, which must fail. Normal concurrent rounds use the production
reconciler unchanged. The web process is resumed in a finally block. Appliance restart must
apply the pending intent without losing IDs or import
history. Deletion removes a subset and checks their absent routes.

Bounds are `--hosts 1..100`, `--concurrency 1..8`, `--rounds 1..5`, uint32 `--seed` (default 70), and
`--timeout-seconds 30..900` (default 600, excluding cold image setup). Each command and recovery wait
is also bounded; an admitted phase finishes before cleanup, so the elapsed time can exceed the guard.
Small overrides proportionally reduce policies, redirects and NPM rows. Reports contain only
allowlisted counts, timings, resource analyses, commit/image identities and static failure categories;
the private fixture data is cleaned up. Image builds can require more time than the workload.

The appliance is constrained to 1 GiB, two CPUs and 512 PIDs; PostgreSQL connection evidence is bounded
at 100. CPU usage is reported, without a throughput target. Configuration growth is measured
separately from eight samples with unchanged final geometry. Only those final samples are compared
for connection/FD growth and sustained memory growth, using the existing reliability allowances
(`4 × concurrency + 16` connections/FDs and 128 MiB sustained memory growth). These short checks can
detect regressions in this workload; they establish neither universal capacity nor long-term leak
freedom. The [Runtime Scale workflow](../.github/workflows/runtime-scale.yml) runs this bounded case on
relevant PR/main changes and manually. It has no long-duration profile or schedule. Release soak
evidence remains a separate check.

A Docker Desktop reference run on Windows with Bun 1.4.2 at
[`1aba761`](https://github.com/RentnerKev/RentnerProxy/commit/1aba761419c73877a35474240f1979f93124d0aa)
passed the default case in 379 seconds after image setup. The 25-host creation command took 1.13 s,
growth to 100 took 2.51 s, and each concurrent fixture command took 7.73–7.92 s for 328 mutations and
407 management reads; these command timings exclude subsequent traffic/revision checks. NPM import
raised the inventory to 110 proxy hosts and 35 redirects. Sampled maxima were 205 MiB, 51% CPU,
54 PIDs, 11 PostgreSQL connections and 23/12/163 web/controller/Caddy FDs. Across the eight unchanged
final samples, connections and web/controller FDs stayed constant, Caddy FDs decreased by five and
memory increased by 3.4 MiB. This observed cost supports the bounded 100-host default within the
600-second guard on that test setup. The samples are not instantaneous peaks or production limits;
retain each CI run's own report for its exact revision and environment.

## Runtime reliability checks

With Docker Engine (Linux containers), Docker Compose, Bun 1.4.2, Git history and the repository
dependencies installed, run the isolated synthetic fixture:

```bash
bun run runtime:reliability -- --profile short --source current --report ./runtime-reliability.json
bun run runtime:reliability -- --profile long --source alpha.6 --report ./runtime-reliability-alpha6.json
```

`current` builds the committed `HEAD` snapshot; fixture services are bundled from the exact matching
Git revision. A supplied `--image` for current is accepted only when its OCI revision matches `HEAD`.
`alpha.6` uses the immutable published Alpha 6 image and its pinned historical source. The fixture creates its own private data and credentials. Never supply production
secrets or private data. Cycle admission stops at the first duration or iteration bound: short defaults
to 120 seconds/3 iterations, long to 1800 seconds/120 iterations, both with concurrency 2. The sanitized
JSON records actual workload elapsed time, excluding cold setup, and whether the requested duration was
reached. In-flight cycles finish their bounded commands, so observed duration can exceed the admission
cap. Retain at least eight quiescent samples for trend evidence; a shorter passing run cannot establish
resource stability. These are fixture guards, not production performance benchmarks. The separate
[Runtime Reliability workflow](../.github/workflows/runtime-reliability.yml) runs short checks for relevant
PR/main changes and long current/Alpha 6 checks weekly or manually. See [Architecture](architecture.md)
for resource evidence limits.

Override bounds with `--duration-seconds 30..7200`, `--iterations 1..1000` and `--concurrency 1..8`
(using one integer, not a range). `--seed` accepts a uint32 (default 69) for repeatable fixture choices;
`--capture-resources true|false` controls sampling (default true). CI manual inputs expose the same
controls. A manual duration override receives a four-hour CI job budget per source, including cold
setup and completion of the last bounded cycle; the default workload durations stay the same.
Disabling resource capture cannot establish resource stability.

The published Alpha 6 baseline has a known certificate-binding retry defect: an accepted asynchronous
retry can leave the job failed while the controller completes issuance. The fixture records
`alpha6-binding-retry-needs-second-request` in `knownLimitations` only for the verified known state,
then sends one bounded second retry for the same job. This represents an additional operator action;
a passing baseline accounts for that limitation. Current builds must complete after one retry and
report no known limitations.

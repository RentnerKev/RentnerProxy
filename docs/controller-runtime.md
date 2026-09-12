# Controller runtime structure

The controller owns certificate material, ACME work, DNS challenge cleanup, and Caddy
activation. The web application submits desired configuration and reads durable operation
status. Caddy remains the single public HTTP data plane.

## Module responsibilities

| Module                                                | Responsibility                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `runtime/mod.rs`                                      | Runtime state, settings, construction, and public exports                    |
| `runtime/lifecycle.rs`                                | Startup, health, bounded recovery, and shutdown                              |
| `runtime/configuration.rs`                            | Validated snapshot persistence, previews, and TLS material selection         |
| `runtime/apply.rs`                                    | Serialized activation and revision acknowledgement                           |
| `runtime/certificate_management.rs`                   | Certificate API operations and candidate activation                          |
| `runtime/renewal.rs`                                  | Renewal scheduling and bounded candidate retry                               |
| `runtime/acme.rs` and `runtime/acme/`                 | Bounded jobs, account registration, orders, and challenges                   |
| `runtime/certificates.rs` and `runtime/certificates/` | Certificate store, staging, durable operations, recovery, and validation     |
| `runtime/dns/`                                        | Provider configuration, credentials, record ownership, and provider requests |
| `runtime/renderer.rs` and `runtime/renderer/`         | Typed Caddy models, routes, access policy, and upstream configuration        |

## Recovery and activation

Only a validated version 7 snapshot is eligible for runtime recovery. Database desired state
wins on the next reconciliation. A failed acknowledgement is ambiguous, so recovery terminates
the process before replaying the last verified configuration. Healthy idle recovery checks the
child process and does not repeatedly render configuration or call the Caddy Admin API.

Accepted activation runs independently of the initiating HTTP connection. The apply lock protects
configuration changes and readiness probes against intermediate state. Runtime startup may fail
after certificate initialization; recovery must retain the live certificate store while accepted
certificate work continues. State paths reject planted links before Caddy writes its autosave.

Issued ACME candidates are persisted before DNS cleanup or runtime activation. A failed activation
retains the candidate for retry and must not initiate a replacement CA order. Imported material
has separate staging semantics. Candidate activation errors must not overwrite the independent
issuance error state. Certificate deletion checks both live and recoverable configurations.

## ACME and DNS ownership

Account registration persists its private key before contacting the CA so an ambiguous response
can be recovered with the same identity. Public ACME requests and test-directory configuration
have separate validation boundaries.

DNS intents preserve the exact authorization name and value before a provider write. Cleanup
must never remove unrelated TXT records. Every successful cleanup removal is persisted, allowing
the next attempt to resume after interruption. Apex and wildcard authorizations may share a TXT
owner, so all required values are presented before challenges are marked ready.

Cleanup and candidate activation remain independent. Cleanup claims the certificate lease and
reloads current credentials and intents before provider access. The bounded sweeps rotate their
starting position so repeatedly failing entries cannot starve other certificates.

## Maintenance

Keep source code free of explanatory comments. Put architectural rationale and operational
invariants in Markdown and express local intent through names and small functions. Functional
tool directives and generated-file markers remain where their tools require them.

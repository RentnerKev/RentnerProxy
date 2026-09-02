# API and service interface

This document describes the HTTP interfaces currently exposed by RentnerProxy. The management UI
is a web application and its server functions are not a stable public REST API. The Rust
controller API is an internal interface and must not be exposed directly to untrusted networks.

All JSON requests use Content-Type: application/json. JSON responses use
Content-Type: application/json. Responses from health, readiness, and runtime-state endpoints
are marked no-store.

## Web application endpoints

### GET /health/live

Liveness does not require authentication.

Success response:

~~~json
{"status":"ok"}
~~~

The response status is 200.

### GET /health/ready

Readiness does not require authentication.

A ready instance returns status 200:

~~~json
{"status":"ready"}
~~~

An instance whose foundation dependencies are not ready returns status 503:

~~~json
{"status":"not_ready"}
~~~

### GET /media/avatars/{userId}

Returns the profile image for the requested user when the request is authorized and an image
exists. The response is an image response with cache behavior chosen by the server. Invalid,
missing, or unauthorized requests do not disclose user data.

## Internal Rust controller endpoints

The controller listens on an internal address. The health and ACME challenge routes are public
only when the surrounding deployment intentionally exposes them.

### GET /health

Returns status 200:

~~~json
{"status":"ok","service":"rentnerproxy-controller","version":"<controller-version>"}
~~~

### GET /ready

Returns status 200 with { "status": "ready" } when the proxy runtime is ready, otherwise status
503 with { "status": "not_ready" }.

### GET /.well-known/acme-challenge/{token}

Returns status 200 and text/plain only for a valid, currently active ACME challenge and matching
canonical Host header. Missing, invalid, or expired challenges return 404.

### Authorization for /internal/v1/*

All internal API routes require an Authorization header when a controller token is configured:

~~~text
Authorization: Bearer <controller-token>
~~~

The production appliance always configures the controller token. The controller compares the
token in constant time and returns 401 for missing or invalid credentials.

### Proxy runtime

- GET /internal/v1/proxy/status — returns the current proxy runtime status as JSON.
- GET /internal/v1/proxy/config — returns { "config": "...", "activeRevision": "..." }.
- PUT /internal/v1/proxy/config — accepts a validated proxy configuration and returns
  { "status": "applied|unchanged", "activeRevision": "...", "lastApplyAt": "..." }.
- POST /internal/v1/proxy/config/preview — accepts a validated proxy configuration and returns
  { "config": "...", "revision": "..." }.
- GET /internal/v1/proxy/hosts/{id}/config — returns the active configuration for one canonical
  host identifier.
- POST /internal/v1/proxy/hosts/{id}/config/preview — accepts one validated host configuration
  and returns its rendered preview.

Invalid JSON, invalid UUIDs, invalid domain names, configuration validation errors, oversized
payloads, unavailable runtime state, and apply failures return a documented 4xx/5xx error category
without exposing internal paths or credentials. The maximum proxy configuration body is 16 MiB.

### Certificate management

- GET /internal/v1/certificates — returns the certificate metadata collection.
- GET /internal/v1/certificates/{id} — returns one certificate metadata object.
- POST /internal/v1/certificates/{id}/import — accepts a validated certificate import request.
- POST /internal/v1/certificates/{id}/issue — starts ACME issuance and returns 202 with operation
  metadata.
- POST /internal/v1/certificates/{id}/renew — starts ACME renewal and returns 202 with operation
  metadata.
- DELETE /internal/v1/certificates/{id} — deletes the selected certificate and returns
  { "deleted": true }.

The controller validates certificate identifiers as UUIDv7 values. Certificate routes are
protected by the controller token even when the listener uses loopback.

### Trusted CA validation

- POST /internal/v1/trusted-cas/validate — accepts { "pem": "..." } and returns the validated
  certificate information or a validation error.

The web application is the intended caller of the internal controller. These endpoints are not a
compatibility promise for third-party clients and may change before the first stable release.

# Proxy host setup guide

Open **Proxy hosts → Add proxy host**. The inline guide opens automatically when the host list is empty. Use **Skip guide** to hide it and **Show setup guide** inside a create or edit form to reopen it. Previous/next steps explain the current fields; they do not save or clear host and certificate drafts. Navigation moves keyboard focus to the current step heading.

## Domains and public ports

Enter concrete DNS hostnames without a protocol, path or port. Point their public DNS records at the proxy and configure the necessary firewall/router forwarding yourself. HTTP-01 requires public inbound TCP port **80** to reach the proxy. Serving public HTTPS requires inbound TCP port **443** to reach the proxy. DNS-01 does not require inbound port 80 for certificate validation; this does not remove the public HTTPS serving requirement. See [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/) and [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

A wildcard **certificate** can cover matching subdomains and requires DNS-01 when requested through ACME. It does not cover the bare domain. RentnerProxy's proxy-host validation requires concrete hostnames and rejects wildcard host entries: assign a suitable wildcard certificate to concrete hosts instead. Certificate coverage does not create DNS records or proxy routes.

## Upstream and TLS

Choose the service address, protocol and port reachable **from the proxy**, for example `http://backend.internal:8080`. This destination port is separate from public ports 80/443. HTTPS upstream verification checks the connection between proxy and service; it is independent of the public-facing certificate. Keep verification enabled and supply the appropriate server name or trusted CA where required.

For public TLS, choose a usable existing/imported certificate covering every host domain, request a new certificate with ACME, or begin with HTTP. HTTP-01 cannot issue wildcard certificates. DNS-01 uses the supported Cloudflare integration and needs the correct zone and API credentials with permission to create TXT records; DNS propagation can take time. Request fields and permission checks remain the normal form's responsibility.

## Saved configuration and job evidence

Saving configuration does not prove a host is reachable. Certificate work continues in the existing durable job workflow: queued/preparing, issuing, applying, applied, failed or needs attention. Follow its progress notification and error details; leaving the form does not cancel background work. A queued or issuing certificate is not ready, and issuing successfully still precedes configuration application.

Fix inline validation errors before saving. For a failed or attention-required certificate job, inspect the error, correct its cause and use the existing retry action. Pending runtime configuration needs application by an authorized operator; if the runtime is unavailable, restore it and retry. Applied configuration is runtime evidence, not a DNS, port-forwarding or upstream reachability test. Check actual access after application.

The guide reads the current form values and existing runtime/job feedback. It does not run DNS/network probes, modify router settings, configure infrastructure or bypass normal authorization and validation.

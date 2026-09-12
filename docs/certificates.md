# Certificates

RentnerProxy supports imported certificates and ACME certificates. HTTP-01 is the default for
ordinary names. Use DNS-01 when the certificate needs a wildcard name or the service cannot receive
HTTP-01 validation traffic.

## DNS-01 with Cloudflare

1. Create a Cloudflare API token limited to the zone that contains the certificate names.
2. Grant the token `Zone / Zone / Read` and `Zone / DNS / Edit` permissions. See
   [Cloudflare's API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).
3. In **Certificates**, choose **DNS-01**, select Cloudflare, and enter the zone ID and token.
4. Request the certificate with the ordinary and wildcard names required by the proxy hosts.

Wildcard and ordinary names can be requested together, but every name must belong to the selected
zone. Keep `APP_ENCRYPTION_KEY` unchanged across restarts, upgrades, and restores so encrypted ACME
credentials remain readable. Treat the API token as a secret and rotate it through Cloudflare when
necessary.

Imported certificates and custom trusted CAs are managed separately. A trusted CA contains public
certificate data only; never import a private key as a trusted CA.

# Access Policies

Access Policies are reusable rules for Proxy Hosts. A host without a policy, or with a
**Public** policy, remains public. Choose **Authenticated** and open **Credentials** to add up
to 32 accounts. Each account has its own username and password. Use HTTPS for credential-based
access; the Proxy Host's existing **Force HTTPS** setting redirects HTTP before the login prompt.

Use the account editor to rename an account or set a new password. Leaving its password field
empty preserves the current password. Account removal and password changes take effect after
the configuration is applied. Removing the last account closes an authenticated policy with
HTTP 403; missing or invalid credentials on a configured policy receive HTTP 401.

Choose **IP-restricted** or **Combined** to configure IP rules in the policy editor. Enter one
IPv4/IPv6 address or CIDR network per line, up to 128 entries in each list. Addresses become
single-address networks and CIDRs are normalized to their network address when saved.

IP rules evaluate the direct connection's address. Forwarding headers do not change that
address; when another proxy sits in front of RentnerProxy, the rules see that proxy's address.
Use IPv6 addresses without zone identifiers. For IPv4-mapped IPv6 addresses, enter the IPv4 equivalent.
IPv4-mapped connections follow the IPv4 rules, including when an IPv6 list contains `::/0`.

**Deny** matches take precedence over **Allow** matches. The explicit default determines what
happens when neither list matches. Default **Deny** with an empty allow list blocks every address;
default **Allow** with an empty deny list permits every address. Removing the IP configuration
closes an IP-restricted policy.

Combined policies use **All** or **Any**. **All** requires both successful authentication and an
allowed IP address. **Any** permits either method: valid credentials can grant access even when
the IP method denies the address. A missing method cannot succeed. Public policies ignore both
methods; authenticated policies ignore stored IP rules.
Policies using Basic Auth remove the Authorization header before forwarding to the application,
including when a combined policy grants access through its IP rules.

After a policy or assignment change, check the runtime status. **Applied** means the desired
configuration is active; **Pending** or **Unavailable** means it has not been confirmed active.
Failed applies retain the last successfully applied configuration. A previously public host
therefore remains public until its first protected configuration is successfully applied;
an already active restriction remains in place if a later relaxation fails.
An assigned policy cannot be deleted, including when its host is disabled; remove or change the
assignment first.

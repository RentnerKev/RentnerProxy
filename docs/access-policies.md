# Access Policies

Access Policies are reusable rules for Proxy Hosts. A host without a policy, or with a
**Public** policy, remains public. Choose **Authenticated** and open **Credentials** to add up
to 32 accounts. Each account has its own username and password. Use HTTPS for credential-based
access; the Proxy Host's existing **Force HTTPS** setting redirects HTTP before the login prompt.

Use the account editor to rename an account or set a new password. Leaving its password field
empty preserves the current password. Account removal and password changes take effect after
the configuration is applied. Removing the last account closes an authenticated policy with
HTTP 403; missing or invalid credentials on a configured policy receive HTTP 401.

Combined policies use **All** or **Any**. **All** requires both authentication and IP rules;
**Any** permits a request when either method succeeds. Until IP rules (#31) are available,
**IP-restricted** and **Combined / All** remain closed. **Combined / Any** can already use
configured Basic Auth accounts.

After a policy or assignment change, check the runtime status. **Applied** means the desired
configuration is active; **Pending** or **Unavailable** means it has not been confirmed active.
Failed applies retain the last successfully applied configuration. A previously public host
therefore remains public until its first protected configuration is successfully applied;
an already active restriction remains in place if a later relaxation fails.
An assigned policy cannot be deleted, including when its host is disabled; remove or change the
assignment first.

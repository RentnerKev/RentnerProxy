# Access Policies

Access Policies are reusable rules for Proxy Hosts. A host without a policy, or with a
**Public** policy, remains public. **Authenticated**, **IP-restricted**, and **Combined** are
currently closed and return HTTP 403 for application requests until the Basic Authentication
(#30) and IP rules (#31) features are available.

Combined policies use **All** or **Any** when those methods are implemented. **All** requires
every method to allow a request; **Any** requires at least one method to allow it.

After a policy or assignment change, check the runtime status. **Applied** means the desired
configuration is active; **Pending** or **Unavailable** means it has not been confirmed active.
Failed applies retain the last successfully applied configuration. A previously public host
therefore remains public until its first protected configuration is successfully applied;
an already active restriction remains in place if a later relaxation fails.
An assigned policy cannot be deleted, including when its host is disabled; remove or change the
assignment first.

import { PERMISSIONS } from './permissions.config.ts'

export const QUICK_SEARCH_LIMIT = 6
export const QUICK_SEARCH_NAVIGATION_LIMIT = 8
export const QUICK_SEARCH_MIN_QUERY_LENGTH = 2
export const QUICK_SEARCH_MAX_QUERY_LENGTH = 128
export const QUICK_SEARCH_DEBOUNCE_MS = 200

export const QUICK_SEARCH_ACTIONS = [
    {
        id: 'createProxyHost',
        to: '/proxy-hosts',
        label: 'admin.proxyHosts.actions.add',
        page: 'shell.proxyHosts',
        intent: 'create',
        keywords: 'proxy proxies proxys reverse domain domains host hosts',
        permissions: [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_CREATE],
    },
    {
        id: 'createRedirectHost',
        to: '/redirect-hosts',
        label: 'admin.redirectHosts.actions.add',
        page: 'shell.redirectHosts',
        intent: 'create',
        keywords: 'redirect redirection forwarding weiterleitung umleitung domain host',
        permissions: [PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_CREATE],
    },
    {
        id: 'requestCertificate',
        to: '/certificates',
        label: 'admin.certificates.actions.request',
        page: 'shell.certificates',
        intent: 'create',
        keywords:
            'certificate certificates cert zertifikat zertifikate ssl tls acme letsencrypt request issue obtain anfordern beantragen',
        permissions: [PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_ISSUE],
    },
    {
        id: 'importCertificate',
        to: '/certificates',
        label: 'admin.certificates.actions.import',
        page: 'shell.certificates',
        intent: 'import',
        keywords: 'certificate certificates cert zertifikat zertifikate ssl tls pem key schlussel',
        permissions: [PERMISSIONS.CERTIFICATES_VIEW, PERMISSIONS.CERTIFICATES_CREATE],
    },
    {
        id: 'importTrustedCa',
        to: '/certificates',
        label: 'admin.trustedCas.actions.import',
        page: 'admin.certificates.tabs.trusted',
        intent: 'import',
        keywords:
            'trusted ca trust root issuer bundle zertifizierungsstelle stammzertifikat vertrauen',
        permissions: [PERMISSIONS.TRUSTED_CAS_VIEW, PERMISSIONS.TRUSTED_CAS_CREATE],
    },
    {
        id: 'createAccessPolicy',
        to: '/access-policies',
        label: 'admin.accessPolicies.actions.add',
        page: 'shell.accessPolicies',
        intent: 'create',
        keywords:
            'access policy policies zugriff zugriffsregel zugriffsregeln schutz auth authentication',
        permissions: [PERMISSIONS.ACCESS_POLICIES_VIEW, PERMISSIONS.ACCESS_POLICIES_CREATE],
    },
    {
        id: 'createDnsConnection',
        to: '/dns-connections',
        label: 'admin.dnsConnections.actions.add',
        page: 'shell.dnsConnections',
        intent: 'create',
        keywords: 'dns connection connections verbindung verbindungen cloudflare token',
        permissions: [PERMISSIONS.DNS_CONNECTIONS_VIEW, PERMISSIONS.DNS_CONNECTIONS_MANAGE],
    },
    {
        id: 'createDdnsRecord',
        to: '/ddns',
        label: 'admin.ddns.editor.addTitle',
        page: 'shell.ddns',
        intent: 'create',
        keywords: 'ddns dynamic dns dyndns record records eintrag eintrage',
        permissions: [
            PERMISSIONS.DDNS_VIEW,
            PERMISSIONS.DDNS_MANAGE,
            PERMISSIONS.DNS_CONNECTIONS_VIEW,
        ],
    },
    {
        id: 'createUser',
        to: '/users',
        label: 'admin.users.actions.add',
        page: 'shell.users',
        intent: 'create',
        keywords: 'user users benutzer account konto einladen invite',
        permissions: [
            PERMISSIONS.USERS_VIEW,
            PERMISSIONS.USERS_CREATE,
            PERMISSIONS.USERS_ASSIGN_ROLES,
            PERMISSIONS.ROLES_VIEW,
        ],
    },
    {
        id: 'createRole',
        to: '/roles',
        label: 'admin.roles.actions.add',
        page: 'shell.roles',
        intent: 'create',
        keywords: 'role roles rolle rollen permission berechtigung berechtigungen',
        permissions: [
            PERMISSIONS.ROLES_VIEW,
            PERMISSIONS.ROLES_CREATE,
            PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
        ],
    },
] as const

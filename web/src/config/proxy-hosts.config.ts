export const PROXY_HOST_FORWARD_SCHEMES = ['http', 'https'] as const

export const MAX_PROXY_HOST_DOMAINS = 50

export const PROXY_HOST_FORM_TABS = [
    { id: 'general', fields: ['domains', 'forwardScheme', 'forwardHost', 'forwardPort'] },
    { id: 'certificate', fields: ['certificateId', 'forceHttps'] },
    {
        id: 'access',
        fields: ['accessPolicyId', 'verifyUpstreamTls', 'upstreamTlsServerName', 'trustedCaId'],
    },
    { id: 'caching', fields: ['responseCompression', 'responseCache', 'browserCache'] },
    { id: 'options', fields: ['enabled', 'tagIds'] },
] as const

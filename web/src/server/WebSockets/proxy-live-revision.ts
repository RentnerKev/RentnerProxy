import { PERMISSIONS } from '@/config/permissions.config.ts'
import type {
    ProxyLiveRevisionDependencies,
    ProxyLiveTopic,
} from './Types/proxy-live-revision.types.ts'

const permissions = {
    'proxy-hosts': PERMISSIONS.PROXY_HOSTS_VIEW,
    'redirect-hosts': PERMISSIONS.REDIRECT_HOSTS_VIEW,
    'access-policies': PERMISSIONS.ACCESS_POLICIES_VIEW,
} as const

export function createProxyLiveRevisionReader(dependencies: ProxyLiveRevisionDependencies) {
    return async (topic: ProxyLiveTopic): Promise<{ revision: string }> => {
        await dependencies.authorize(permissions[topic])
        const [digest, runtime] = await Promise.all([
            dependencies.readDigest(topic),
            dependencies.readRuntime(),
        ])
        if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid live database digest')
        return {
            revision: new Bun.CryptoHasher('sha256')
                .update(JSON.stringify({ version: 1, topic, digest, runtime }))
                .digest('hex'),
        }
    }
}

import { useQuery } from '@tanstack/react-query'

import { getApplicationUpdateHandler } from '../middleware.ts'
import type { ApplicationUpdateResult } from '../Types/application-update.types.ts'

export default function useApplicationUpdateQuery(): ApplicationUpdateResult | undefined {
    const localPreview =
        import.meta.env.DEV &&
        typeof window !== 'undefined' &&
        window.location.origin === 'http://localhost:5173' &&
        new URLSearchParams(window.location.search).get('update-preview') === '1'
    const query = useQuery({
        queryKey: ['application-update'],
        queryFn: () => getApplicationUpdateHandler(),
        enabled: !localPreview,
        staleTime: 5 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
        refetchIntervalInBackground: false,
        retry: false,
    })
    if (localPreview) {
        return {
            status: 'available',
            checkedAt: null,
            currentChannel: null,
            latest: {
                version: '1.0.0-beta.2',
                tag: 'v1.0.0-beta.2',
                channel: 'beta',
                url: 'https://github.com/RentnerKev/RentnerProxy/releases',
                notes: 'LOKALE VORSCHAU – simuliertes Update.\n\nSo erscheint eine neue Version im Update-Dialog. Es wurde kein echtes Release geprüft und kein Update installiert.',
                image: {
                    status: 'pending',
                    reference: null,
                    digest: null,
                    platform: 'linux/amd64',
                },
                compatibility: {
                    status: 'unsupported',
                    minimumVersion: null,
                    intermediateVersion: null,
                },
            },
        }
    }
    return query.isError
        ? { status: 'unavailable', checkedAt: null, currentChannel: null, latest: null }
        : query.data
}

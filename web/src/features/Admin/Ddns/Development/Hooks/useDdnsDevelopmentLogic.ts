import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createDdnsDemoApi } from '../ddns-demo.ts'
import type { DdnsPageProps } from '../../Types/ddns-ui.types.ts'
import type { DdnsDevelopmentLogicResult } from '../Types/ddns-development.types.ts'

function createSession() {
    return {
        api: createDdnsDemoApi(),
        queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    }
}

export default function useDdnsDevelopmentLogic(props: DdnsPageProps): DdnsDevelopmentLogicResult {
    const liveClient = useQueryClient()
    const [demoEnabled, setDemoEnabled] = useState(false)
    const [session, setSession] = useState(createSession)
    const [epoch, setEpoch] = useState(0)
    useEffect(() => () => session.queryClient.clear(), [session])
    return {
        state: {
            demoEnabled,
            sessionKey: `${demoEnabled ? 'demo' : 'live'}-${epoch}`,
            api: demoEnabled ? session.api : props.api,
            queryClient: demoEnabled ? session.queryClient : liveClient,
        },
        handler: {
            toggleDemo: () => setDemoEnabled((enabled) => !enabled),
            resetDemo: () => {
                setSession(createSession())
                setEpoch((current) => current + 1)
            },
        },
    }
}

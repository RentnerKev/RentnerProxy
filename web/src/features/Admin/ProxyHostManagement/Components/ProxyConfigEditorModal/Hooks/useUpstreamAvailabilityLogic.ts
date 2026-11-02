import { useQuery } from '@tanstack/react-query'
import { getProxyHostUpstreamHealthHandler } from '../../../middleware.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { formatProxyHostForward } from '@/lib/Admin/ProxyHostManagement/proxyHostTableCells.ts'
import type {
    UpstreamAvailabilityLogicResult,
    UpstreamAvailabilityProps,
} from '../Types/upstream-availability.types.ts'

/**
 * Polls open, enabled pooled hosts and matches target order while the server validates observation age.
 * Browser query staleness, initial pending loads, mismatches and failed refreshes expose unknown availability.
 * Controller timestamps are parsed without comparing the independent browser and appliance clocks.
 */
export default function useUpstreamAvailabilityLogic({
    host,
    open,
}: UpstreamAvailabilityProps): UpstreamAvailabilityLogicResult {
    const enabled = open && Boolean(host.upstreamPool) && host.enabled
    const query = useQuery({
        queryKey: proxyHostManagementQueryKeys.upstreamHealth(host.id),
        queryFn: () => getProxyHostUpstreamHealthHandler({ data: { proxyHostId: host.id } }),
        enabled,
        staleTime: 6_000,
        refetchInterval: enabled ? 3_000 : false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: false,
    })
    const data = query.data
    const observedAt = data?.observedAt ? Date.parse(data.observedAt) : Number.NaN
    const sameMembers =
        host.upstreamPool?.members.length === data?.members.length &&
        host.upstreamPool?.members.every((member, index) => {
            const observation = data?.members[index]
            return (
                observation?.index === index &&
                observation.host === member.host &&
                observation.port === member.port
            )
        })
    const fresh =
        enabled &&
        !query.isPending &&
        !query.isError &&
        !query.isStale &&
        Boolean(data?.revision) &&
        Number.isFinite(observedAt) &&
        sameMembers &&
        data?.hostId === host.id
    const availability = fresh ? data!.state : 'unknown'
    return {
        state: {
            visible: Boolean(host.upstreamPool),
            availability,
            reason: !host.enabled
                ? 'disabled'
                : query.isPending
                  ? 'loading'
                  : query.isError
                    ? 'error'
                    : availability === 'unknown'
                      ? 'unknown'
                      : null,
            members: (host.upstreamPool?.members ?? []).map((member, index) => ({
                index,
                target: formatProxyHostForward(host.forwardScheme, member.host, member.port),
                state:
                    fresh && availability !== 'unknown' ? data!.members[index]!.state : 'unknown',
            })),
        },
    }
}

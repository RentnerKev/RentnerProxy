import { useCallback, useState } from 'react'
import type {
    HostDomainListOptions,
    HostDomainListResult,
} from '../Types/host-domain-list.types.ts'
export default function useHostDomainList({
    initialDomains,
    maxDomains,
    isPending,
    form,
}: HostDomainListOptions): HostDomainListResult {
    const [domainKeys, setDomainKeys] = useState(() =>
        initialDomains.map(() => crypto.randomUUID()),
    )
    const addDomain = useCallback(() => {
        if (form.state.values.domains.length >= maxDomains || isPending) return
        form.pushFieldValue('domains', '')
        setDomainKeys((keys) => [...keys, crypto.randomUUID()])
    }, [form, maxDomains, isPending])
    const removeDomain = useCallback(
        (index: number) => {
            if (form.state.values.domains.length <= 1 || isPending) return
            void form.removeFieldValue('domains', index)
            setDomainKeys((keys) => keys.filter((_key, position) => position !== index))
        },
        [form, isPending],
    )
    return { state: { domainKeys }, handler: { addDomain, removeDomain } }
}

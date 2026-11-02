import { useStore } from '@tanstack/react-form'
import { UPSTREAM_FAILOVER_DEFAULTS } from '@/config/upstream-pools.config.ts'
import { getUpstreamFailoverFormValues } from '@/lib/Admin/ProxyHostManagement/proxyHostFormValues.ts'
import type {
    UpstreamFailoverFieldsProps,
    UpstreamFailoverFieldsLogicResult,
    UpstreamFailoverNumberField,
} from '../Types/upstream-failover-fields.types.ts'

export default function useUpstreamFailoverFieldsLogic({
    form,
    isPending,
}: Pick<UpstreamFailoverFieldsProps, 'form' | 'isPending'>): UpstreamFailoverFieldsLogicResult {
    const failover = useStore(form.store, (state) => state.values.upstreamPool?.failover)
    const revalidate = () => {
        if (form.state.submissionAttempts > 0) void form.validate('submit')
    }
    const activeFields: UpstreamFailoverNumberField[] = [
        {
            name: 'upstreamPool.failover.active.intervalSeconds',
            label: 'intervalSeconds',
            min: 5,
            max: 300,
            placeholder: '10',
        },
        {
            name: 'upstreamPool.failover.active.timeoutSeconds',
            label: 'timeoutSeconds',
            min: 1,
            max: 30,
            placeholder: '2',
        },
        {
            name: 'upstreamPool.failover.active.fails',
            label: 'fails',
            min: 1,
            max: 10,
            placeholder: '2',
        },
        {
            name: 'upstreamPool.failover.active.passes',
            label: 'passes',
            min: 1,
            max: 10,
            placeholder: '2',
        },
        {
            name: 'upstreamPool.failover.active.expectedStatus',
            label: 'expectedStatus',
            min: 200,
            max: 399,
            placeholder: '200',
        },
    ]
    const passiveFields: UpstreamFailoverNumberField[] = [
        {
            name: 'upstreamPool.failover.passive.failDurationSeconds',
            label: 'failDurationSeconds',
            min: 1,
            max: 300,
            placeholder: '30',
        },
        {
            name: 'upstreamPool.failover.passive.maxFails',
            label: 'maxFails',
            min: 1,
            max: 10,
            placeholder: '1',
        },
    ]
    const retryFields: UpstreamFailoverNumberField[] = [
        {
            name: 'upstreamPool.failover.retries.maxRetries',
            label: 'maxRetries',
            min: 1,
            max: 15,
            placeholder: '2',
        },
        {
            name: 'upstreamPool.failover.retries.tryDurationSeconds',
            label: 'tryDurationSeconds',
            min: 1,
            max: 30,
            placeholder: '5',
        },
        {
            name: 'upstreamPool.failover.retries.tryIntervalMilliseconds',
            label: 'tryIntervalMilliseconds',
            min: 100,
            max: 5000,
            placeholder: '250',
        },
    ]
    return {
        state: {
            sections: [
                {
                    feature: 'active',
                    enabled: Boolean(failover?.active),
                    disabled: isPending,
                    fields: activeFields,
                },
                {
                    feature: 'passive',
                    enabled: Boolean(failover?.passive),
                    disabled: isPending,
                    fields: passiveFields,
                },
                {
                    feature: 'retries',
                    enabled: Boolean(failover?.retries),
                    disabled: isPending || !failover?.passive,
                    fields: retryFields,
                },
            ],
        },
        handler: {
            handleToggle: (feature, enabled) => {
                const pool = form.getFieldValue('upstreamPool')
                if (!pool || isPending || (feature === 'retries' && !pool.failover?.passive)) return
                const next = { ...pool.failover }
                if (enabled) {
                    const defaults = getUpstreamFailoverFormValues(UPSTREAM_FAILOVER_DEFAULTS)
                    if (feature === 'active') next.active = defaults.active!
                    if (feature === 'passive') next.passive = defaults.passive!
                    if (feature === 'retries') next.retries = defaults.retries!
                } else {
                    delete next[feature]
                    if (feature === 'passive') delete next.retries
                }
                const nextPool = { ...pool }
                if (Object.keys(next).length) nextPool.failover = next
                else delete nextPool.failover
                form.setFieldValue('upstreamPool', nextPool)
                revalidate()
            },
            handleNumberChange: (name, value) => {
                form.setFieldValue(name, value)
                revalidate()
            },
            handlePathChange: (value) => {
                form.setFieldValue('upstreamPool.failover.active.path', value)
                revalidate()
            },
        },
    }
}

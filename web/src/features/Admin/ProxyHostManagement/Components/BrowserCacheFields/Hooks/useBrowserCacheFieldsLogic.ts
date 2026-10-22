import { useId, useRef } from 'react'
import { browserCacheSettingsSchema } from '../../../config-validation.ts'
import type { BrowserCacheSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { BrowserCacheFieldsProps } from '../Types/browser-cache-fields.types.ts'

export default function useBrowserCacheFieldsLogic({ value, onChange }: BrowserCacheFieldsProps) {
    const id = useId()
    const ruleKeys = useRef<string[]>([])
    const getRuleKey = (index: number) =>
        ruleKeys.current[index] ?? (ruleKeys.current[index] = crypto.randomUUID())
    const updateRule = (index: number, patch: Partial<BrowserCacheSettings['rules'][number]>) => {
        if (value)
            onChange({
                ...value,
                rules: value.rules.map((entry, i) =>
                    i === index ? { ...entry, ...patch } : entry,
                ),
            })
    }
    return {
        state: {
            id,
            invalid: value !== undefined && !browserCacheSettingsSchema.safeParse(value).success,
        },
        handler: {
            getRuleKey,
            updateRule,
            setEnabled: (enabled: boolean) => onChange({ enabled, rules: value?.rules ?? [] }),
            removeRule: (index: number) => {
                ruleKeys.current.splice(index, 1)
                if (value) onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })
            },
            addRule: () =>
                onChange({
                    enabled: value?.enabled ?? false,
                    rules: [
                        ...(value?.rules ?? []),
                        { path: '', maxAgeSeconds: 3600, immutable: false },
                    ],
                }),
        },
    }
}

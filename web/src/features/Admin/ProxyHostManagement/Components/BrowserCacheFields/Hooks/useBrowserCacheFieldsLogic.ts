import { useId, useRef, useState } from 'react'
import { browserCacheSettingsSchema } from '../../../config-validation.ts'
import type { BrowserCacheSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { BrowserCacheFieldsProps } from '../Types/browser-cache-fields.types.ts'

export default function useBrowserCacheFieldsLogic({
    value,
    onChange,
    disabled,
}: BrowserCacheFieldsProps) {
    const id = useId()
    const [ruleKeys, setRuleKeys] = useState<string[]>([])
    const nextRuleKey = useRef(0)
    const [maxAgeDrafts, setMaxAgeDrafts] = useState<Record<string, string>>({})
    const getRuleKey = (index: number) => ruleKeys[index] ?? `${id}-saved-rule-${index}`
    const updateRule = (index: number, patch: Partial<BrowserCacheSettings['rules'][number]>) => {
        if (value?.enabled && !disabled)
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
            rules: (value?.rules ?? []).map((rule, index) => {
                const key = getRuleKey(index)
                const draft = maxAgeDrafts[key]
                return {
                    path: rule.path,
                    immutable: rule.immutable,
                    key,
                    maxAgeValue:
                        draft !== undefined && Object.is(Number(draft), rule.maxAgeSeconds)
                            ? draft
                            : String(rule.maxAgeSeconds),
                }
            }),
        },
        handler: {
            updateRule,
            setEnabled: (enabled: boolean) => {
                if (disabled) return
                let rules = value?.rules ?? []
                if (enabled && rules.length === 0) {
                    rules = [{ path: '', maxAgeSeconds: 3600, immutable: false }]
                    setRuleKeys([`${id}-rule-${nextRuleKey.current++}`])
                }
                if (!enabled && !browserCacheSettingsSchema.safeParse({ enabled, rules }).success) {
                    const retained: BrowserCacheSettings['rules'][number][] = []
                    const retainedKeys: string[] = []
                    for (const [index, rule] of rules.entries()) {
                        if (
                            browserCacheSettingsSchema.safeParse({
                                enabled,
                                rules: [...retained, rule],
                            }).success
                        ) {
                            retained.push(rule)
                            retainedKeys.push(getRuleKey(index))
                        }
                    }
                    rules = retained
                    setRuleKeys(retainedKeys)
                    setMaxAgeDrafts({})
                }
                onChange({ enabled, rules })
            },
            setMaxAge: (index: number, draft: string) => {
                if (disabled || !value?.enabled) return
                const key = getRuleKey(index)
                setMaxAgeDrafts((current) => ({ ...current, [key]: draft }))
                updateRule(index, { maxAgeSeconds: Number(draft) })
            },
            removeRule: (index: number) => {
                if (disabled || !value?.enabled) return
                const key = getRuleKey(index)
                setMaxAgeDrafts((current) => {
                    const next = { ...current }
                    delete next[key]
                    return next
                })
                setRuleKeys(value.rules.flatMap((_, i) => (i === index ? [] : [getRuleKey(i)])))
                onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })
            },
            addRule: () => {
                if (disabled || !value?.enabled || value.rules.length >= 20) return
                setRuleKeys([
                    ...value.rules.map((_, index) => getRuleKey(index)),
                    `${id}-rule-${nextRuleKey.current++}`,
                ])
                onChange({
                    enabled: true,
                    rules: [...value.rules, { path: '', maxAgeSeconds: 3600, immutable: false }],
                })
            },
        },
    }
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from '@rentnerkev/toasts'
import { checkManualDnsHandler } from '../../middleware.ts'
import type { ManualDnsCheckResult } from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export interface ManualDnsReadOnlyCheckInput {
    readonly input: {
        readonly certificateId: string
        readonly operationId: string
        readonly challengeSetId: string
    } | null
    readonly proof: string
    readonly expiresAt: string | null
    readonly disabled: boolean
}

export default function useManualDnsReadOnlyCheck({
    input,
    proof,
    expiresAt,
    disabled,
}: ManualDnsReadOnlyCheckInput) {
    const { t } = useTranslationStore()
    const [now, setNow] = useState(() => Date.now())
    const [checked, setChecked] = useState<{ key: string; check: ManualDnsCheckResult } | null>(
        null,
    )
    const [pendingKey, setPendingKey] = useState('')
    const pending = useRef(new Set<string>())
    const signature = JSON.stringify({ input, proof, expiresAt, disabled })
    const [generation, setGeneration] = useState({ signature, value: 0 })
    const version = generation.signature === signature ? generation.value : generation.value + 1
    if (generation.signature !== signature) setGeneration({ signature, value: version })
    const key = `${version}:${signature}`
    const latestKey = useRef(key)
    useLayoutEffect(() => {
        latestKey.current = key
        return () => {
            latestKey.current = ''
        }
    }, [key])
    const expired = Boolean(expiresAt && Date.parse(expiresAt) <= now)
    useEffect(() => {
        if (!expiresAt || Date.parse(expiresAt) <= now) return
        const remaining = Date.parse(expiresAt) - Date.now()
        const timer = setTimeout(
            () => setNow(Date.now()),
            Math.max(0, Math.min(remaining + 1, 2_147_483_647)),
        )
        return () => clearTimeout(timer)
    }, [expiresAt, now])
    return {
        state: {
            check: checked?.key === key ? checked.check : null,
            checking: pendingKey === key,
            canCheck: Boolean(input) && !disabled && !expired,
            expired,
        },
        handler: {
            check: async () => {
                if (
                    !input ||
                    disabled ||
                    expired ||
                    (expiresAt && Date.parse(expiresAt) <= Date.now()) ||
                    pending.current.has(key)
                )
                    return
                pending.current.add(key)
                setPendingKey(key)
                setChecked(null)
                try {
                    const result = await checkManualDnsHandler({ data: input })
                    if (latestKey.current !== key) return
                    if (!result.success) {
                        toast.error(t(result.message), { title: t('toast.titles.error') })
                        return
                    }
                    const check = result.check
                    if (
                        check.certificateId !== input.certificateId ||
                        check.operationId !== input.operationId ||
                        check.challengeSetId !== input.challengeSetId ||
                        check.expiresAt !== expiresAt
                    )
                        throw new Error('stale')
                    setChecked({ key, check })
                } catch {
                    if (latestKey.current === key)
                        toast.error(t('admin.certificates.errors.actionFailed'), {
                            title: t('toast.titles.error'),
                        })
                } finally {
                    pending.current.delete(key)
                    setPendingKey((current) => (current === key ? '' : current))
                }
            },
        },
    }
}

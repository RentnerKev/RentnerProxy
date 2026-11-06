import type { RecoveryCodesModalLogicResult } from '../Types/recovery-codes-modal.types.ts'
import { useEffect, useRef } from 'react'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useRecoveryCodesModalLogic(
    codes: ReadonlyArray<string> | null,
    onClose: () => void,
) {
    const { t } = useTranslationStore()
    const generation = useRef(0)
    const active = useRef(false)
    useEffect(() => {
        active.current = codes !== null
        return () => {
            active.current = false
            generation.current += 1
        }
    }, [codes])
    const copy = async () => {
        const currentCodes = codes
        if (!currentCodes || !active.current) return
        const currentGeneration = generation.current
        try {
            await navigator.clipboard.writeText(currentCodes.join('\n'))
            if (currentGeneration !== generation.current) return
            toast.success(t('account.recoveryCodes.copied'), { title: t('toast.titles.success') })
        } catch {
            if (currentGeneration !== generation.current) return
            toast.error(t('admin.certificates.manualDns.copyFailed'), {
                title: t('toast.titles.error'),
            })
        }
    }
    return {
        handler: {
            handleOpenChange: (open) => {
                if (!open) {
                    active.current = false
                    generation.current += 1
                    onClose()
                }
            },
            copy,
        },
    } satisfies RecoveryCodesModalLogicResult
}

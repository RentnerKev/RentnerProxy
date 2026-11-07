import { useEffect, useRef } from 'react'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import { APP_VERSION } from '@/lib/ApplicationVersion/version.ts'
import type {
    ApplicationUpdateDialogLogicResult,
    ApplicationUpdateDialogProps,
} from '../Types/application-update-dialog.types.ts'

export default function useApplicationUpdateDialogLogic(
    data: ApplicationUpdateDialogProps['data'],
    open: boolean,
): ApplicationUpdateDialogLogicResult {
    const { t } = useTranslationStore()
    const reference =
        data?.latest?.image.status === 'verified' &&
        data.latest.compatibility.status !== 'requires-beta1'
            ? data.latest.image.reference
            : null
    const generation = useRef(0)
    const active = useRef(false)
    useEffect(() => {
        active.current = open && reference !== null
        return () => {
            active.current = false
            generation.current += 1
        }
    }, [reference, open])
    const releaseUrl = data?.latest?.url
    const isOfficialUrl = releaseUrl?.startsWith(
        'https://github.com/RentnerProxy/RentnerProxy/releases/',
    )
    const copyReference = async () => {
        if (!reference || !open || !active.current) return
        const currentGeneration = ++generation.current
        try {
            await navigator.clipboard.writeText(reference)
            if (currentGeneration !== generation.current) return
            toast.success(t('updates.copyStates.copied'), { title: t('toast.titles.success') })
        } catch {
            if (currentGeneration !== generation.current) return
            toast.error(t('updates.copyStates.failed'), { title: t('toast.titles.error') })
        }
    }

    return {
        state: {
            currentVersion: APP_VERSION,
            releaseUrl: isOfficialUrl
                ? releaseUrl!
                : 'https://github.com/RentnerProxy/RentnerProxy/releases',
            canCopy: open && reference !== null,
        },
        handler: {
            handleCopy: () => {
                void copyReference()
            },
        },
    }
}

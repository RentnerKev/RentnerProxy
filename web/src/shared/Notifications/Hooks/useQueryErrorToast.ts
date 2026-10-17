import { useEffect, useRef } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useQueryErrorToast(isError: boolean, message: string) {
    const { t } = useTranslationStore()
    const reported = useRef(false)
    useEffect(() => {
        if (!isError) {
            reported.current = false
            return
        }
        if (reported.current) return
        reported.current = true
        toast.error(t(message), { title: t('toast.titles.error') })
    }, [isError, message, t])
}

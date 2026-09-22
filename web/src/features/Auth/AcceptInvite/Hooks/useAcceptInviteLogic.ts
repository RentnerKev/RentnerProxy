import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import useFragmentToken from '../../Shared/Hooks/useFragmentToken'
import { acceptInviteHandler } from '../server'
import { acceptInviteFormSchema } from '../validation'
import type { AcceptInviteFormValues } from '../Types/accept-invite-form.types'

export default function useAcceptInviteLogic() {
    const token = useFragmentToken()
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: (values: AcceptInviteFormValues) =>
            acceptInviteHandler({ data: { ...values, token: token ?? '' } }),
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
                return
            }

            toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: () =>
            toast.error(t('Authentication service temporarily unavailable.'), {
                title: t('toast.titles.error'),
            }),
    })
    const form = useForm({
        defaultValues: {
            displayName: '',
            password: '',
            confirmPassword: '',
        } satisfies AcceptInviteFormValues,
        validators: { onSubmit: acceptInviteFormSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {}
        },
    })

    return {
        state: {
            form,
            token,
            isPending: mutation.isPending,
        },
    }
}

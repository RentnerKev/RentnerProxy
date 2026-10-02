import {
    displayNameSchema,
    getPasswordConfirmationMessage,
    getValidationMessage,
    newPasswordSchema,
} from '@/lib/Auth/validation.ts'
import type { AcceptInviteLogicResult } from '../Types/accept-invite-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useFragmentToken from '@/shared/Auth/Hooks/useFragmentToken.ts'
import { acceptInviteHandler } from '../middleware.ts'
import { acceptInviteFormSchema } from '../validation.ts'
import type { AcceptInviteFormValues } from '../Types/accept-invite-form.types.ts'

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
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            validateDisplayName: ({ value }) => getValidationMessage(displayNameSchema, value),
            validatePassword: ({ value }) => getValidationMessage(newPasswordSchema, value),
            validateConfirmPassword: ({ value }) =>
                getPasswordConfirmationMessage(form.getFieldValue('password'), value),
        },
        form,
        state: {
            token,
            isPending: mutation.isPending,
        },
    } satisfies AcceptInviteLogicResult<typeof form>
}

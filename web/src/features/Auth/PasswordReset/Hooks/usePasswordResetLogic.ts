import {
    getPasswordConfirmationMessage,
    getValidationMessage,
    newPasswordSchema,
} from '@/lib/Auth/validation.ts'
import type { PasswordResetLogicResult } from '../Types/password-reset-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useFragmentToken from '@/shared/Auth/Hooks/useFragmentToken.ts'
import { resetPasswordHandler } from '../middleware.ts'
import { passwordConfirmationInputSchema } from '../validation.ts'
import type { PasswordResetFormValues } from '../Types/password-reset-form.types.ts'

export default function usePasswordResetLogic() {
    const token = useFragmentToken()
    const navigate = useNavigate()
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: (values: PasswordResetFormValues) =>
            resetPasswordHandler({ data: { ...values, token: token ?? '' } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            await navigate({ to: '/login', replace: true })
            toast.success(t(result.message), { title: t('toast.titles.success') })
        },
        onError: () =>
            toast.error(t('Authentication service temporarily unavailable.'), {
                title: t('toast.titles.error'),
            }),
    })
    const form = useForm({
        defaultValues: {
            password: '',
            confirmPassword: '',
        } satisfies PasswordResetFormValues,
        validators: { onSubmit: passwordConfirmationInputSchema },
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
            validatePassword: ({ value }) => getValidationMessage(newPasswordSchema, value),
            validateConfirmPassword: ({ value }) =>
                getPasswordConfirmationMessage(form.getFieldValue('password'), value),
        },
        form,
        state: {
            token,
            isPending: mutation.isPending,
        },
    } satisfies PasswordResetLogicResult<typeof form>
}

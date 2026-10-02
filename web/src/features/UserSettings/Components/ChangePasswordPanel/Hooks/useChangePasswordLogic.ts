import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import { credentialPasswordSchema, newPasswordSchema } from '@/lib/Auth/validation.ts'
import type { ChangePasswordLogicResult } from '../Types/change-password-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { changePasswordHandler } from '../../../middleware.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { changePasswordInputSchema } from '../../../validation.ts'
import type { ChangePasswordFormValues } from '../Types/change-password-form.types.ts'

export default function useChangePasswordLogic() {
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: (values: ChangePasswordFormValues) => changePasswordHandler({ data: values }),
    })
    const form = useForm({
        defaultValues: {
            currentPassword: '',
            password: '',
            confirmPassword: '',
        } satisfies ChangePasswordFormValues,
        validators: { onSubmit: changePasswordInputSchema },
        onSubmit: async ({ value, formApi }) => {
            mutation.reset()
            try {
                const result = await mutation.mutateAsync(value)
                if (result.success) {
                    formApi.reset()
                    toast.success(t(result.message), { title: t('toast.titles.success') })
                } else {
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                }
            } catch {
                toast.error(t('account.password.error.update'), { title: t('toast.titles.error') })
            }
        },
    })

    return {
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            validateCurrentPassword: ({ value }) =>
                getValidationIssue(credentialPasswordSchema, value),
            validatePassword: ({ value }) => getValidationIssue(newPasswordSchema, value),
            validateConfirmPassword: ({ value }) => {
                const password = form.getFieldValue('password')
                return password === value ? undefined : 'account.validation.passwordsDoNotMatch'
            },
        },
        form,
        state: {
            isPending: mutation.isPending,
        },
    } satisfies ChangePasswordLogicResult<typeof form>
}

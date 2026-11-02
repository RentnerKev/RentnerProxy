import { useForm } from '@tanstack/react-form'
import type { ProviderDraft } from '../Types/oidc-providers.types.ts'
export default function useOidcProviderForm(
    defaultValues: ProviderDraft,
    onSubmit: () => Promise<void>,
) {
    return useForm({ defaultValues, onSubmit })
}

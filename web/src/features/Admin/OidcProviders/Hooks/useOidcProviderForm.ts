import { useForm } from '@tanstack/react-form'
import type { ProviderDraft } from '../Types/oidc-providers.types.ts'

/** Connects a provider draft to its asynchronous save workflow. */
export default function useOidcProviderForm(
    defaultValues: ProviderDraft,
    onSubmit: () => Promise<void>,
) {
    return useForm({ defaultValues, onSubmit })
}

import type {
    RedirectHostEditorFormValues,
    RedirectHostFormModalProps,
} from '@/features/Admin/RedirectHostManagement/Components/RedirectHostFormModal/Types/redirect-host-form.types.ts'
export function getRedirectHostFormDefaultValues(
    mode: RedirectHostFormModalProps['mode'],
    redirectHost?: RedirectHostFormModalProps['redirectHost'],
): RedirectHostEditorFormValues {
    return {
        ...(mode !== 'create' && redirectHost?.tags
            ? { tagIds: redirectHost.tags.map((tag) => tag.id) }
            : {}),
        domains: mode === 'edit' && redirectHost ? [...redirectHost.domains] : [''],
        destination: redirectHost?.destination ?? '',
        statusCode: String(redirectHost?.statusCode ?? 302),
        preserveRequestUri: redirectHost?.preserveRequestUri ?? true,
        enabled: redirectHost?.enabled ?? true,
        certificateId: redirectHost?.certificateId ?? null,
    }
}

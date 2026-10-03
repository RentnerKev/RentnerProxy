import { useEffect, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts/toast'

import { DEFAULT_SITE_MODES } from '@/config/default-site.config.ts'
import { getDefaultSiteHandler, saveDefaultSiteHandler } from '@/features/DefaultSite/middleware.ts'
import { defaultSiteSettingsSchema } from '@/lib/DefaultSite/defaultSite.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    DefaultSiteEditorData,
    DefaultSiteSettings,
} from '@/lib/DefaultSite/Types/default-site.types.ts'
import type {
    DefaultSiteFormValues,
    DefaultSitePanelLogicResult,
} from '../Types/default-site-panel.types.ts'

export function useDefaultSitePanelLogic(canUpdate: boolean) {
    const { t } = useTranslationStore()
    const [error, setError] = useState<string | null>(null)
    const [runtimeStatus, setRuntimeStatus] = useState<'applied' | 'pending' | null>(null)
    const [baseline, setBaseline] = useState<DefaultSiteEditorData | null>(null)
    const saveInFlight = useRef(false)
    const query = useQuery({
        queryKey: ['default-site'],
        queryFn: () => getDefaultSiteHandler(),
        refetchOnWindowFocus: false,
        retry: false,
    })
    const mutation = useMutation({
        mutationFn: (settings: DefaultSiteSettings) =>
            saveDefaultSiteHandler({
                data: { baseRevision: baseline!.baseRevision, settings },
            }),
    })
    if (!baseline && query.data) {
        setBaseline(query.data)
    }
    const savedSettings = baseline?.settings
    const form = useForm({
        defaultValues: {
            mode: savedSettings?.mode ?? 'not-found',
            url: savedSettings?.mode === 'redirect' ? savedSettings.url : '',
            html: savedSettings?.mode === 'custom-html' ? savedSettings.html : '',
        } satisfies DefaultSiteFormValues,
        onSubmit: async ({ value }) => {
            if (!canUpdate || !baseline || query.isFetching || saveInFlight.current) return
            const settings = defaultSiteSettingsSchema.safeParse(
                value.mode === 'redirect'
                    ? { mode: value.mode, url: value.url }
                    : value.mode === 'custom-html'
                      ? { mode: value.mode, html: value.html }
                      : { mode: value.mode },
            )
            if (!settings.success) return
            saveInFlight.current = true
            setError(null)
            try {
                const result = await mutation.mutateAsync(settings.data)
                if (!result.success) {
                    setError(t(result.message))
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                    return
                }
                setRuntimeStatus(result.runtimeStatus)
                toast.success(
                    t(
                        result.runtimeStatus === 'pending'
                            ? 'defaultSite.pending'
                            : 'defaultSite.saved',
                    ),
                    { title: t('toast.titles.success') },
                )
                const refreshed = await query.refetch()
                if (refreshed.isSuccess) {
                    setBaseline(refreshed.data)
                    const { settings: loaded } = refreshed.data
                    form.reset({
                        mode: loaded.mode,
                        url: loaded.mode === 'redirect' ? loaded.url : '',
                        html: loaded.mode === 'custom-html' ? loaded.html : '',
                    })
                }
            } catch {
                setError(t('defaultSite.errors.saveFailed'))
                toast.error(t('defaultSite.errors.saveFailed'), { title: t('toast.titles.error') })
            } finally {
                saveInFlight.current = false
            }
        },
    })
    useEffect(() => {
        if (!baseline) return
        const { settings } = baseline
        form.reset({
            mode: settings.mode,
            url: settings.mode === 'redirect' ? settings.url : '',
            html: settings.mode === 'custom-html' ? settings.html : '',
        })
    }, [baseline, form])

    const values = useStore(form.store, (state) => state.values)
    const settings =
        values.mode === 'redirect'
            ? { mode: values.mode, url: values.url }
            : values.mode === 'custom-html'
              ? { mode: values.mode, html: values.html }
              : { mode: values.mode }
    const validated = defaultSiteSettingsSchema.safeParse(settings)
    const isDirty = !!baseline && JSON.stringify(settings) !== JSON.stringify(baseline.settings)
    const isSaving = mutation.isPending

    return {
        form,
        state: {
            isLoading: query.isPending,
            loadFailed: query.isError,
            isSaving,
            isReloading: query.isFetching,
            mode: values.mode,
            savedMode: baseline?.settings.mode ?? null,
            canSave: canUpdate && isDirty && validated.success && !isSaving && !query.isFetching,
            isDirty,
            isValid: validated.success,
            htmlBytes: new TextEncoder().encode(values.html).byteLength,
            error,
            runtimeStatus,
            modeOptions: DEFAULT_SITE_MODES.map((mode) => ({
                value: mode,
                label: t(`defaultSite.modes.${mode}`),
            })),
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                void form.handleSubmit()
            },
            handleReload: () => {
                setError(null)
                void query.refetch().then((result) => {
                    if (result.isSuccess) {
                        setBaseline(result.data)
                        const { settings: loaded } = result.data
                        form.reset({
                            mode: loaded.mode,
                            url: loaded.mode === 'redirect' ? loaded.url : '',
                            html: loaded.mode === 'custom-html' ? loaded.html : '',
                        })
                    }
                })
            },
            handleModeChange: (value) => {
                const mode = DEFAULT_SITE_MODES.find((candidate) => candidate === value)
                if (mode) form.setFieldValue('mode', mode)
            },
        },
    } satisfies DefaultSitePanelLogicResult<typeof form>
}

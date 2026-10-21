import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from '@rentnerkev/toasts'
import { z } from 'zod'
import type { PickerMessages } from '@rentnerkev/picker'
import { DEFAULT_HOST_TAG_COLOR } from '@/config/host-tags.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { hostTagNameSchema } from '@/lib/HostTags/hostTags.ts'
import { hostTagColorSchema } from '@/lib/HostTags/hostTagColor.ts'
import type { HostKind, HostTag, HostTagMutation } from '@/lib/HostTags/Types/host-tags.types.ts'
import { getHostTagCatalogHandler, mutateHostTagHandler } from '../middleware.ts'

export default function useHostTagManagerLogic(kind: HostKind) {
    const { language, t } = useTranslationStore()
    const formId = useId()
    const [open, setOpen] = useState(false)
    const [isColorValid, setIsColorValid] = useState(true)
    const [pickerContainer, setPickerContainer] = useState<HTMLDivElement | null>(null)
    const [editing, setEditing] = useState<{ tag: HostTag; revision: number } | null>(null)
    const [deleting, setDeleting] = useState<{ tag: HostTag; revision: number } | null>(null)
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: ['admin', kind + '-hosts', 'tags'],
        queryFn: () => getHostTagCatalogHandler({ data: kind }),
        enabled: open,
    })
    const mutation = useMutation({
        mutationFn: (data: HostTagMutation) => mutateHostTagHandler({ data }),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['admin', kind + '-hosts'] })
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                if (
                    result.message === 'admin.hostTags.errors.conflict' ||
                    result.message === 'admin.hostTags.errors.missing'
                ) {
                    setEditing(null)
                    setDeleting(null)
                    resetForm()
                }
                return
            }
            setEditing(null)
            setDeleting(null)
            resetForm()
            toast.success(t('admin.hostTags.saved'), { title: t('toast.titles.success') })
        },
        onError: () =>
            toast.error(t('admin.hostTags.errors.saveFailed'), { title: t('toast.titles.error') }),
    })
    const form = useForm({
        defaultValues: { name: '', color: DEFAULT_HOST_TAG_COLOR },
        validators: { onSubmit: z.object({ name: hostTagNameSchema, color: hostTagColorSchema }) },
        onSubmit: async ({ value }) => {
            if (!query.data || !isColorValid) return
            const input: HostTagMutation = editing
                ? {
                      kind,
                      action: 'rename',
                      tagId: editing.tag.id,
                      name: value.name,
                      color: value.color,
                      expectedRevision: editing.revision,
                  }
                : {
                      kind,
                      action: 'create',
                      name: value.name,
                      color: value.color,
                      expectedRevision: query.data.revision,
                  }
            await mutation.mutateAsync(input).catch(() => undefined)
        },
    })
    function resetForm() {
        form.reset()
        setIsColorValid(true)
    }
    return {
        form,
        state: {
            open,
            formId,
            editing,
            deleting,
            tags: query.data?.tags ?? [],
            pending: mutation.isPending,
            loading: query.isPending,
            error: query.isError,
            isColorValid,
            pickerContainer,
            pickerLocale: language === 'de' ? ('de' as const) : ('en' as const),
            pickerMessages: {
                required: t('userAppearance.picker.required'),
                invalidColor: t('userAppearance.picker.invalidColor'),
                eyeDropper: t('userAppearance.picker.eyeDropper'),
                closePicker: t('userAppearance.picker.closePicker'),
                colorArea: t('userAppearance.picker.colorArea'),
                colorAreaInstructions: t('userAppearance.picker.colorAreaInstructions'),
                colorAreaValue: (saturation, value) =>
                    t('userAppearance.picker.colorAreaValue', { saturation, value }),
                hue: t('userAppearance.picker.hue'),
                saturation: t('admin.hostTags.colorSaturation'),
                brightness: t('admin.hostTags.colorBrightness'),
                selectColor: t('userAppearance.picker.selectColor'),
                presetColor: (color) => t('userAppearance.picker.presetColor', { color }),
            } satisfies Partial<PickerMessages>,
        },
        handler: {
            setOpen: (value: boolean) => {
                if (!mutation.isPending) {
                    setOpen(value)
                    setEditing(null)
                    setDeleting(null)
                    resetForm()
                }
            },
            submit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            rename: (tag: HostTag) => {
                if (!query.data) return
                setEditing({ tag, revision: query.data.revision })
                form.setFieldValue('name', tag.name)
                form.setFieldValue('color', tag.color ?? DEFAULT_HOST_TAG_COLOR)
                setIsColorValid(true)
            },
            cancelRename: () => {
                setEditing(null)
                resetForm()
            },
            requestDelete: (tag: HostTag) => {
                if (query.data) setDeleting({ tag, revision: query.data.revision })
            },
            setDeleteOpen: (value: boolean) => {
                if (!value && !mutation.isPending) setDeleting(null)
            },
            confirmDelete: async () => {
                if (deleting)
                    await mutation
                        .mutateAsync({
                            kind,
                            action: 'delete',
                            tagId: deleting.tag.id,
                            expectedRevision: deleting.revision,
                        })
                        .catch(() => undefined)
            },
            retry: () => {
                void query.refetch()
            },
        },
        setter: { setIsColorValid },
        refs: { pickerContainer: setPickerContainer },
    }
}

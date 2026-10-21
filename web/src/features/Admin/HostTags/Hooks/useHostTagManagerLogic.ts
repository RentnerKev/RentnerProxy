import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from '@rentnerkev/toasts'
import { z } from 'zod'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { hostTagNameSchema } from '@/lib/HostTags/hostTags.ts'
import type { HostKind, HostTag, HostTagMutation } from '@/lib/HostTags/Types/host-tags.types.ts'
import { getHostTagCatalogHandler, mutateHostTagHandler } from '../middleware.ts'

export default function useHostTagManagerLogic(kind: HostKind) {
    const { t } = useTranslationStore()
    const formId = useId()
    const [open, setOpen] = useState(false)
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
                    form.reset()
                }
                return
            }
            setEditing(null)
            setDeleting(null)
            form.reset()
            toast.success(t('admin.hostTags.saved'), { title: t('toast.titles.success') })
        },
        onError: () =>
            toast.error(t('admin.hostTags.errors.saveFailed'), { title: t('toast.titles.error') }),
    })
    const form = useForm({
        defaultValues: { name: '' },
        validators: { onSubmit: z.object({ name: hostTagNameSchema }) },
        onSubmit: async ({ value }) => {
            if (!query.data) return
            const input: HostTagMutation = editing
                ? {
                      kind,
                      action: 'rename',
                      tagId: editing.tag.id,
                      name: value.name,
                      expectedRevision: editing.revision,
                  }
                : {
                      kind,
                      action: 'create',
                      name: value.name,
                      expectedRevision: query.data.revision,
                  }
            await mutation.mutateAsync(input).catch(() => undefined)
        },
    })
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
        },
        handler: {
            setOpen: (value: boolean) => {
                if (!mutation.isPending) {
                    setOpen(value)
                    setEditing(null)
                    setDeleting(null)
                    form.reset()
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
            },
            cancelRename: () => {
                setEditing(null)
                form.reset()
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
    }
}

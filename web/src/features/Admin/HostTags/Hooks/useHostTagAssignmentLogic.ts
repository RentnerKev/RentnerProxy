import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import type { HostTagsCellProps } from '../Types/host-tags-ui.types.ts'
import { getHostTagCatalogHandler, mutateHostTagHandler } from '../middleware.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useHostTagAssignmentLogic(props: HostTagsCellProps) {
    const { t } = useTranslationStore()
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState<string[]>([])
    const [baseline, setBaseline] = useState<string[]>([])
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: ['admin', props.kind + '-hosts', 'tags'],
        queryFn: () => getHostTagCatalogHandler({ data: props.kind }),
        enabled: open,
    })
    const revision = query.data?.revision ?? null
    const mutation = useMutation({
        mutationFn: () => {
            if (revision === null) throw new Error('admin.hostTags.errors.loadFailed')
            return mutateHostTagHandler({
                data: {
                    kind: props.kind,
                    action: 'assign',
                    hostId: props.hostId,
                    tagIds: selected,
                    expectedTagIds: baseline,
                    expectedRevision: revision,
                },
            })
        },
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['admin', props.kind + '-hosts'] })
            if (result.success) {
                toast.success(t('admin.hostTags.saved'), { title: t('toast.titles.success') })
                setOpen(false)
            } else {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                if (result.message === 'admin.hostTags.errors.conflict') setOpen(false)
            }
        },
        onError: () =>
            toast.error(t('admin.hostTags.errors.saveFailed'), { title: t('toast.titles.error') }),
    })
    return {
        state: {
            open,
            selected,
            pending: mutation.isPending,
            ready: revision !== null && !query.isError && !query.isPending && !query.isFetching,
        },
        handler: {
            edit: () => {
                const ids = (props.tags ?? []).map((tag) => tag.id)
                setSelected(ids)
                setBaseline(ids)
                setOpen(true)
            },
            setOpen: (value: boolean) => {
                if (!mutation.isPending) setOpen(value)
            },
            select: setSelected,
            save: () => mutation.mutate(),
        },
    }
}

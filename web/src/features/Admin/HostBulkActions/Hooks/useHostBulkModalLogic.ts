import { toast } from '@rentnerkev/toasts'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import type {
    BulkHostAction,
    BulkHostResult,
} from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import type {
    BulkHostFormValues,
    BulkHostModalProps,
    BulkHostModalLogicResult,
} from '../Types/bulk-hosts-ui.types.ts'
import { availableBulkHostActions } from '@/lib/HostBulkActions/bulkHostActions.ts'
import { bulkHostActionSchema } from '../validation.ts'
import { applyBulkHostsHandler, previewBulkHostsHandler } from '../middleware.ts'
import { getAssignableAccessPoliciesHandler } from '@/features/Admin/AccessPolicyManagement/middleware.ts'
import { getAssignableCertificatesHandler } from '@/features/Admin/CertificateManagement/middleware.ts'
import { certificateManagementQueryKeys } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import { accessPolicyManagementQueryKeys } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { redirectHostManagementQueryKeys } from '@/lib/Admin/RedirectHostManagement/redirectHostManagementCache.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

function actionFrom(values: BulkHostFormValues): BulkHostAction {
    const { type, tagIds, assignmentId } = values
    return bulkHostActionSchema.parse(
        type === 'addTags' || type === 'removeTags'
            ? { type, tagIds }
            : type === 'certificate'
              ? { type, certificateId: assignmentId || null }
              : type === 'accessPolicy'
                ? { type, accessPolicyId: assignmentId || null }
                : { type },
    )
}

export default function useHostBulkModalLogic(props: BulkHostModalProps): BulkHostModalLogicResult {
    const { t } = useTranslationStore()
    const id = useId()
    const client = useQueryClient()
    const generation = useRef({ scope: '', version: 0 })
    const scope = JSON.stringify([props.kind, props.hostIds, props.permissions])
    useEffect(() => {
        const currentGeneration = generation.current
        currentGeneration.scope = scope
        return () => {
            currentGeneration.version += 1
        }
    }, [scope])
    const types = availableBulkHostActions(props.kind, props.permissions)
    const [preview, setPreview] = useState<{
        action: BulkHostAction
        result: BulkHostResult
    } | null>(null)
    const [result, setResult] = useState<BulkHostResult | null>(null)
    const [resultScope, setResultScope] = useState(scope)
    if (resultScope !== scope) {
        setResultScope(scope)
        setPreview(null)
        setResult(null)
    }
    const form = useForm({
        defaultValues: {
            type: types[0] ?? 'enable',
            tagIds: [],
            assignmentId: '',
        } as BulkHostFormValues,
    })
    const values = useStore(form.store, (state) => state.values)
    const certificates = useQuery({
        queryKey: certificateManagementQueryKeys.assignable,
        queryFn: () => getAssignableCertificatesHandler(),
        enabled: values.type === 'certificate' && types.includes('certificate'),
        staleTime: 30_000,
    })
    const policies = useQuery({
        queryKey: accessPolicyManagementQueryKeys.assignable,
        queryFn: () => getAssignableAccessPoliciesHandler(),
        enabled: values.type === 'accessPolicy' && types.includes('accessPolicy'),
        staleTime: 30_000,
    })
    const previewMutation = useMutation({
        mutationFn: async (_generation: number) => {
            const action = actionFrom(form.state.values)
            const response = await previewBulkHostsHandler({
                data: { kind: props.kind, hostIds: [...props.hostIds], action },
            })
            if (!response.success) throw new Error(response.message)
            return { action, result: response.value }
        },
        onSuccess: (value, attemptGeneration) => {
            if (attemptGeneration !== generation.current.version) return
            setPreview(value)
            setResult(null)
        },
        onError: (_error, attemptGeneration) => {
            if (attemptGeneration !== generation.current.version) return
            setPreview(null)
            toast.error(t('admin.bulkHosts.error'), { title: t('toast.titles.error') })
        },
    })
    const applyMutation = useMutation({
        mutationFn: async (_generation: number) => {
            if (!preview) throw new Error('Preview required')
            const hosts = preview.result.rows.flatMap((row) =>
                row.status === 'ready' && row.version ? [{ id: row.id, version: row.version }] : [],
            )
            const response = await applyBulkHostsHandler({
                data: { kind: props.kind, hosts, action: preview.action },
            })
            if (!response.success) throw new Error(response.message)
            return {
                ...response.value,
                rows: preview.result.rows.map(
                    (row) => response.value.rows.find((next) => next.id === row.id) ?? row,
                ),
            }
        },
        onSuccess: (value, attemptGeneration) => {
            void Promise.all([
                client.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.all }),
                client.invalidateQueries({ queryKey: redirectHostManagementQueryKeys.all }),
            ]).catch(() => undefined)
            if (attemptGeneration !== generation.current.version) return
            setResult(value)
            setPreview(null)
            if (value.runtimeStatus === 'pending') {
                toast.warning(t('admin.proxyHosts.runtime.savedPending'), {
                    title: t('toast.titles.warning'),
                })
            } else if (
                value.rows.some((row) => row.status === 'failed' || row.status === 'skipped')
            ) {
                toast.warning(t('admin.bulkHosts.retryHint'), { title: t('toast.titles.warning') })
            } else {
                toast.success(t('admin.bulkHosts.status.applied'), {
                    title: t('toast.titles.success'),
                })
            }
        },
        onError: (_error, attemptGeneration) => {
            if (attemptGeneration !== generation.current.version) return
            setPreview(null)
            toast.error(t('admin.bulkHosts.error'), { title: t('toast.titles.error') })
        },
    })
    const pending = previewMutation.isPending || applyMutation.isPending
    const optionsQuery = values.type === 'certificate' ? certificates : policies
    const needsOptions = values.type === 'certificate' || values.type === 'accessPolicy'
    const reportedOptionsError = useRef<unknown>(null)
    useEffect(() => {
        if (!needsOptions || !optionsQuery.isError) return
        if (reportedOptionsError.current === optionsQuery.error) return
        reportedOptionsError.current = optionsQuery.error
        toast.error(t('admin.bulkHosts.error'), { title: t('toast.titles.error') })
    }, [needsOptions, optionsQuery.isError, optionsQuery.error, t])
    const reset = () => {
        setPreview(null)
        setResult(null)
    }
    return {
        state: {
            id,
            values,
            pending,
            result,
            rows: result?.rows ?? preview?.result.rows ?? [],
            canApply: Boolean(preview?.result.rows.some((row) => row.status === 'ready')),
            canPreview:
                types.includes(values.type) &&
                (!needsOptions || optionsQuery.isSuccess) &&
                ((values.type !== 'addTags' && values.type !== 'removeTags') ||
                    values.tagIds.length > 0),
            actionOptions: types.map((type) => ({
                value: type,
                label: t('admin.bulkHosts.actions.' + type),
            })),
            assignmentOptions: [
                { value: '', label: t('admin.bulkHosts.none') },
                ...(optionsQuery.data ?? []).map((item) => ({ value: item.id, label: item.name })),
            ],
            optionsLoading: needsOptions && optionsQuery.isPending,
            optionsError: needsOptions && optionsQuery.isError,
        },
        handler: {
            handleTypeChange: (type: BulkHostAction['type']) => {
                reset()
                form.setFieldValue('type', type)
                form.setFieldValue('tagIds', [])
                form.setFieldValue('assignmentId', '')
            },
            handleTagsChange: (tagIds: string[]) => {
                reset()
                form.setFieldValue('tagIds', tagIds)
            },
            handleAssignmentChange: (assignmentId: string) => {
                reset()
                form.setFieldValue('assignmentId', assignmentId)
            },
            handlePreview: () => {
                setPreview(null)
                previewMutation.mutate(generation.current.version)
            },
            handleApply: () => applyMutation.mutate(generation.current.version),
        },
    }
}

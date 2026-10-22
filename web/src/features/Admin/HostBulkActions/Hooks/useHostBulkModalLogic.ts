import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
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
    const types = availableBulkHostActions(props.kind, props.permissions)
    const [preview, setPreview] = useState<{
        action: BulkHostAction
        result: BulkHostResult
    } | null>(null)
    const [result, setResult] = useState<BulkHostResult | null>(null)
    const [error, setError] = useState<string | null>(null)
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
        mutationFn: async () => {
            const action = actionFrom(form.state.values)
            const response = await previewBulkHostsHandler({
                data: { kind: props.kind, hostIds: [...props.hostIds], action },
            })
            if (!response.success) throw new Error(response.message)
            return { action, result: response.value }
        },
        onSuccess: (value) => {
            setPreview(value)
            setResult(null)
            setError(null)
        },
        onError: () => {
            setPreview(null)
            setError(t('admin.bulkHosts.error'))
        },
    })
    const applyMutation = useMutation({
        mutationFn: async () => {
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
        onSuccess: (value) => {
            setResult(value)
            setPreview(null)
            setError(null)
            void Promise.all([
                client.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.all }),
                client.invalidateQueries({ queryKey: redirectHostManagementQueryKeys.all }),
            ]).catch(() => undefined)
        },
        onError: () => {
            setPreview(null)
            setError(t('admin.bulkHosts.error'))
        },
    })
    const pending = previewMutation.isPending || applyMutation.isPending
    const optionsQuery = values.type === 'certificate' ? certificates : policies
    const needsOptions = values.type === 'certificate' || values.type === 'accessPolicy'
    const reset = () => {
        setPreview(null)
        setResult(null)
        setError(null)
    }
    return {
        state: {
            id,
            values,
            pending,
            error,
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
                setError(null)
                previewMutation.mutate()
            },
            handleApply: () => applyMutation.mutate(),
            handleRetryOptions: () => {
                void optionsQuery.refetch()
            },
        },
    }
}

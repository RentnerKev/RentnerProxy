import { createElement, useMemo, useRef, useState } from 'react'
import { filterFn_equalsString } from '@tanstack/react-table'
import type { ColumnDef, FilterFn } from '@tanstack/react-table'
import type { ManagedBackupJob } from '@/lib/Backups/Types/backups.types.ts'
import {
    formatBackupBytes,
    formatBackupDate,
    formatBackupDuration,
} from '@/lib/Backups/presentation.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import BackupStateBadge from '../../BackupStateBadge.tsx'
import BackupActions from '../Components/BackupActions.tsx'
import type {
    BackupHistoryLogicResult,
    BackupHistoryProps,
    BackupHistorySelection,
} from '../Types/backup-history.types.ts'

const getRowId = (job: ManagedBackupJob) => job.id

export default function useBackupHistoryLogic(props: BackupHistoryProps): BackupHistoryLogicResult {
    const { t, locale } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const [selection, setSelection] = useState<BackupHistorySelection | null>(null)
    const [pending, setPending] = useState(false)
    const busy = useRef(false)
    const active = props.jobs.some((job) => job.state === 'queued' || job.state === 'running')
    const selectedJob = props.jobs.find((job) => job.id === selection?.jobId)
    const confirmationDisabled =
        pending ||
        !props.canManage ||
        props.locked ||
        active ||
        !selectedJob ||
        (selection?.action === 'restore' &&
            (selectedJob.state !== 'succeeded' ||
                !selectedJob.retained ||
                !selectedJob.artifact ||
                selectedJob.artifact.id !== selectedJob.id))
    const data = useMemo(() => [...props.jobs], [props.jobs])
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, ManagedBackupJob>>>(
        () => [
            {
                accessorKey: 'requestedAt',
                header: t('admin.backups.history.columns.requestedAt'),
                enableColumnFilter: false,
                cell: ({ row }) =>
                    createElement(
                        'div',
                        { className: 'grid gap-1' },
                        createElement(
                            'span',
                            { className: 'whitespace-nowrap' },
                            formatBackupDate(row.original.requestedAt, locale),
                        ),
                        createElement(
                            'span',
                            { className: 'font-mono text-xs text-muted' },
                            row.original.id,
                        ),
                    ),
            },
            {
                accessorKey: 'origin',
                header: t('admin.backups.history.columns.origin'),
                filterFn: filterFn_equalsString,
                cell: ({ row }) => t(`admin.backups.origins.${row.original.origin}`),
            },
            {
                accessorKey: 'state',
                header: t('admin.backups.history.columns.state'),
                filterFn: filterFn_equalsString,
                cell: ({ row }) =>
                    createElement(
                        'div',
                        { className: 'grid justify-items-start gap-2' },
                        createElement(BackupStateBadge, { state: row.original.state }),
                        row.original.error
                            ? createElement(
                                  'span',
                                  { className: 'max-w-64 text-xs text-danger-text' },
                                  t(`admin.backups.errors.${row.original.error}`),
                              )
                            : null,
                    ),
            },
            {
                id: 'source',
                accessorFn: (job) => job.source.version,
                header: t('admin.backups.history.columns.source'),
                enableColumnFilter: false,
                cell: ({ row }) =>
                    createElement(
                        'div',
                        { className: 'grid gap-1 font-mono text-xs' },
                        createElement('span', null, row.original.source.version),
                        row.original.source.revision
                            ? createElement(
                                  'span',
                                  { title: row.original.source.revision, className: 'text-muted' },
                                  row.original.source.revision.slice(0, 12),
                              )
                            : null,
                    ),
            },
            {
                id: 'duration',
                accessorFn: (job) => job.durationMs ?? undefined,
                header: t('admin.backups.history.columns.duration'),
                enableColumnFilter: false,
                sortUndefined: 'last',
                cell: ({ row }) => formatBackupDuration(row.original.durationMs, locale),
            },
            {
                id: 'size',
                accessorFn: (job) => job.artifact?.bytes,
                header: t('admin.backups.history.columns.size'),
                enableColumnFilter: false,
                sortUndefined: 'last',
                cell: ({ row }) =>
                    row.original.artifact
                        ? formatBackupBytes(row.original.artifact.bytes, locale)
                        : '—',
            },
            {
                id: 'actions',
                header: t('admin.backups.history.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                cell: ({ row }) => {
                    const job = row.original
                    const reason =
                        job.state !== 'succeeded'
                            ? t('admin.backups.history.notReady')
                            : !job.retained
                              ? t('admin.backups.history.expired')
                              : !job.artifact || job.artifact.id !== job.id
                                ? t('admin.backups.history.missingArtifact')
                                : ''
                    const unavailable = !!reason || props.locked || active || pending
                    return createElement(BackupActions, {
                        label: t('admin.backups.history.actionsLabel', { id: job.id }),
                        items: [
                            {
                                id: 'download',
                                type: 'link',
                                label: t('admin.backups.history.download'),
                                href: `/api/admin/backups/${job.id}/download`,
                                disabled: unavailable || !props.canDownload,
                                description:
                                    reason || (!props.canManage ? t('admin.backups.viewOnly') : ''),
                            },
                            {
                                id: 'restore',
                                label: t('admin.backups.history.restore'),
                                danger: true,
                                disabled: unavailable || !props.canManage,
                                description:
                                    reason || (!props.canManage ? t('admin.backups.viewOnly') : ''),
                                onSelect: () => setSelection({ jobId: job.id, action: 'restore' }),
                            },
                            {
                                id: 'delete',
                                label: t('admin.backups.history.delete'),
                                danger: true,
                                disabled: props.locked || active || pending || !props.canManage,
                                description: !props.canManage ? t('admin.backups.viewOnly') : '',
                                onSelect: () => setSelection({ jobId: job.id, action: 'delete' }),
                            },
                        ],
                    })
                },
            },
        ],
        [locale, props.canDownload, props.canManage, props.locked, active, pending, t],
    )
    const globalFilterFn = useMemo<FilterFn<ClientTableFeatures, ManagedBackupJob>>(
        () => (row, _columnId, value) =>
            [
                row.original.id,
                row.original.source.version,
                row.original.source.revision ?? '',
                t(`admin.backups.states.${row.original.state}`),
                t(`admin.backups.origins.${row.original.origin}`),
                formatBackupDate(row.original.requestedAt, locale),
            ]
                .join(' ')
                .toLocaleLowerCase(locale)
                .includes(String(value).trim().toLocaleLowerCase(locale)),
        [locale, t],
    )
    const { table, state, handler } = useClientTable({
        data,
        columns,
        getRowId,
        initialSorting: [{ id: 'requestedAt', desc: true }],
        globalFilterFn,
    })
    return {
        table,
        state: {
            searchInput: state.searchInput,
            showColumnFilters,
            selection,
            pending,
            confirmationDisabled,
            columnFilterConfigs: {
                state: {
                    type: 'select',
                    placeholder: t('table.all'),
                    options: (
                        ['queued', 'running', 'succeeded', 'failed', 'interrupted'] as const
                    ).map((value) => ({
                        value,
                        label: t(`admin.backups.states.${value}`),
                        content: createElement(BackupStateBadge, { state: value }),
                    })),
                },
                origin: {
                    type: 'select',
                    placeholder: t('table.all'),
                    options: (['manual', 'schedule'] as const).map((value) => ({
                        value,
                        label: t(`admin.backups.origins.${value}`),
                    })),
                },
            },
        },
        handler: {
            handleSearchInputChange: handler.handleSearchInputChange,
            handleResetFilters: handler.handleResetFilters,
            handleToggleColumnFilters: () => setShowColumnFilters((value) => !value),
            handleConfirmationOpenChange: (open) => {
                if (!open && !busy.current) setSelection(null)
            },
            handleConfirmAction: async () => {
                if (!selection || confirmationDisabled || busy.current) return
                busy.current = true
                setPending(true)
                try {
                    if (selection.action === 'restore') await props.onRestore(selection.jobId)
                    else await props.onDelete(selection.jobId)
                } catch {
                    // The page action handler exposes the endpoint error; dismiss this confirmation.
                    return
                } finally {
                    busy.current = false
                    setPending(false)
                    setSelection(null)
                }
            },
        },
    }
}

import { CustomSelect } from '@rentnerkev/select/select'
import { Modal } from '@/shared/Modal/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import HostTagSelect from '@/features/Admin/HostTags/Components/HostTagSelect.tsx'
import type { BulkHostAction } from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import type { BulkHostModalProps } from '../Types/bulk-hosts-ui.types.ts'
import useHostBulkModalLogic from '../Hooks/useHostBulkModalLogic.ts'

export default function HostBulkModal(props: BulkHostModalProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useHostBulkModalLogic(props)
    return (
        <Modal
            open
            onOpenChange={props.onOpenChange}
            title={t('admin.bulkHosts.open')}
            description={t('admin.bulkHosts.description', { count: props.hostIds.length })}
            size="lg"
            closeDisabled={state.pending}
            footer={
                <>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.pending}
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('common.closeDialog')}
                    </button>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.pending || !state.canPreview}
                        onClick={handler.handlePreview}
                    >
                        {t(
                            state.result
                                ? 'admin.bulkHosts.previewAgain'
                                : 'admin.bulkHosts.preview',
                        )}
                    </button>
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        disabled={state.pending || !state.canApply}
                        onClick={handler.handleApply}
                    >
                        {t(state.pending ? 'common.loading' : 'admin.bulkHosts.apply')}
                    </button>
                </>
            }
        >
            <div className="grid gap-4">
                <CustomSelect
                    id={state.id + '-action'}
                    label={t('admin.bulkHosts.action')}
                    value={state.values.type}
                    options={state.actionOptions}
                    disabled={state.pending}
                    onValueChange={(value) =>
                        handler.handleTypeChange(value as BulkHostAction['type'])
                    }
                />
                {state.values.type === 'addTags' || state.values.type === 'removeTags' ? (
                    <HostTagSelect
                        kind={props.kind}
                        value={state.values.tagIds}
                        onChange={handler.handleTagsChange}
                        disabled={state.pending}
                    />
                ) : null}
                {state.values.type === 'certificate' || state.values.type === 'accessPolicy' ? (
                    <CustomSelect
                        id={state.id + '-assignment'}
                        label={t('admin.bulkHosts.actions.' + state.values.type)}
                        value={state.values.assignmentId}
                        options={state.assignmentOptions}
                        disabled={state.pending || state.optionsLoading || state.optionsError}
                        onValueChange={handler.handleAssignmentChange}
                    />
                ) : null}
                {state.optionsError ? (
                    <div role="alert">
                        {t('admin.bulkHosts.error')}{' '}
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.handleRetryOptions}
                        >
                            {t('common.retry')}
                        </button>
                    </div>
                ) : null}
                {state.error ? (
                    <p role="alert" className="text-danger-text">
                        {state.error}
                    </p>
                ) : null}
                {state.result?.runtimeStatus === 'pending' ? (
                    <p role="alert" className="text-warning-text">
                        {t('admin.proxyHosts.runtime.savedPending')}
                    </p>
                ) : null}
                {state.rows.length ? (
                    <div className="overflow-x-auto" aria-live="polite">
                        <table className="w-full text-left text-sm">
                            <caption className="pb-2 text-left font-bold">
                                {t(
                                    state.result
                                        ? 'admin.bulkHosts.results'
                                        : 'admin.bulkHosts.preview',
                                )}
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col" className="p-2">
                                        {t('admin.bulkHosts.host')}
                                    </th>
                                    <th scope="col" className="p-2">
                                        {t('admin.bulkHosts.outcome')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.rows.map((row) => (
                                    <tr key={row.id} className="border-t border-border">
                                        <th scope="row" className="break-all p-2 font-normal">
                                            {row.label ?? row.id}
                                        </th>
                                        <td className="p-2">
                                            {t('admin.bulkHosts.status.' + row.status)}
                                            {row.reason ? (
                                                <span className="mt-1 block text-muted">
                                                    {t('admin.bulkHosts.reasons.' + row.reason)}
                                                </span>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
                {state.result ? (
                    <p className="text-sm text-muted">{t('admin.bulkHosts.retryHint')}</p>
                ) : null}
            </div>
        </Modal>
    )
}

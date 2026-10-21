import { TextInput } from '@rentnerkev/inputs'
import { Tags } from 'lucide-react'
import type { HostKind } from '@/lib/HostTags/Types/host-tags.types.ts'
import { HOST_TAG_LIMITS } from '@/config/host-tags.config.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useHostTagManagerLogic from '../Hooks/useHostTagManagerLogic.ts'

export default function HostTagManager({ kind }: { readonly kind: HostKind }) {
    const { state, handler, form } = useHostTagManagerLogic(kind)
    const { t } = useTranslationStore()
    return (
        <>
            <button
                type="button"
                className={buttonClassName('secondary')}
                onClick={() => handler.setOpen(true)}
            >
                <Tags className="size-4" aria-hidden="true" />
                {t('admin.hostTags.manage')}
            </button>
            <Modal
                open={state.open}
                onOpenChange={handler.setOpen}
                title={t('admin.hostTags.manage')}
                description={t('admin.hostTags.description')}
                size="lg"
                closeDisabled={state.pending || Boolean(state.deleting)}
            >
                {state.loading ? (
                    <output>{t('common.loading')}</output>
                ) : state.error ? (
                    <div role="alert">
                        {t('admin.hostTags.errors.loadFailed')}
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <p className="text-sm text-muted">{t('admin.hostTags.behavior')}</p>
                        <form
                            id={state.formId}
                            className="flex flex-wrap items-end gap-2"
                            onSubmit={handler.submit}
                            noValidate
                        >
                            <form.Field name="name">
                                {(field) => (
                                    <div className="min-w-0 flex-1">
                                        <TextInput
                                            id={state.formId + '-name'}
                                            label={t('admin.hostTags.name')}
                                            value={field.state.value}
                                            maxLength={HOST_TAG_LIMITS.nameLength}
                                            disabled={state.pending}
                                            onBlur={field.handleBlur}
                                            onChange={(event) =>
                                                field.handleChange(event.target.value)
                                            }
                                        />
                                        {field.state.meta.errors.length ? (
                                            <p role="alert" className="text-sm text-danger-text">
                                                {t('admin.hostTags.errors.invalid')}
                                            </p>
                                        ) : null}
                                    </div>
                                )}
                            </form.Field>
                            <button
                                type="submit"
                                className={buttonClassName('primary')}
                                disabled={state.pending}
                            >
                                {t(state.editing ? 'common.save' : 'admin.hostTags.create')}
                            </button>
                            {state.editing ? (
                                <button
                                    type="button"
                                    className={buttonClassName('secondary')}
                                    onClick={handler.cancelRename}
                                    disabled={state.pending}
                                >
                                    {t('common.cancel')}
                                </button>
                            ) : null}
                        </form>
                        <ul className="grid gap-2" aria-label={t('admin.hostTags.title')}>
                            {state.tags.map((tag) => (
                                <li
                                    key={tag.id}
                                    className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border p-3"
                                >
                                    <span className="min-w-0 flex-1 break-words">{tag.name}</span>
                                    <button
                                        type="button"
                                        className={buttonClassName('secondary')}
                                        disabled={state.pending}
                                        onClick={() => handler.rename(tag)}
                                        aria-label={t('admin.hostTags.renameNamed', {
                                            name: tag.name,
                                        })}
                                    >
                                        {t('admin.hostTags.rename')}
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClassName('secondary')}
                                        disabled={state.pending}
                                        onClick={() => handler.requestDelete(tag)}
                                        aria-label={t('admin.hostTags.deleteNamed', {
                                            name: tag.name,
                                        })}
                                    >
                                        {t('common.delete')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {!state.tags.length ? (
                            <p className="text-sm text-muted">{t('admin.hostTags.empty')}</p>
                        ) : null}
                    </div>
                )}
            </Modal>
            {state.deleting ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteOpen}
                    title={t('admin.hostTags.deleteNamed', { name: state.deleting.tag.name })}
                    description={t('admin.hostTags.deleteDescription')}
                    destructive
                    confirmLabel={t('common.delete')}
                    pendingLabel={t('common.saving')}
                    isPending={state.pending}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}

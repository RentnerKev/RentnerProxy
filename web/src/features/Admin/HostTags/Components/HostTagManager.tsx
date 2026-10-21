import { TextInput } from '@rentnerkev/inputs'
import { CustomColorPicker, type CustomColorPickerDesign } from '@rentnerkev/picker'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { Tags } from 'lucide-react'
import type { HostKind } from '@/lib/HostTags/Types/host-tags.types.ts'
import { HOST_TAG_LIMITS } from '@/config/host-tags.config.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useHostTagManagerLogic from '../Hooks/useHostTagManagerLogic.ts'
import HostTagBadge from './HostTagBadge.tsx'

const pickerDesign: CustomColorPickerDesign = {
    bg: 'bg-surface-raised',
    border: 'border-input-border',
    text: 'text-ink',
    placeholder: 'placeholder:text-muted-soft',
    focusRing: 'focus-within:ring-accent-ring/30',
    focusBorder: 'focus-within:border-accent-ring',
    errorBorder: 'border-danger-text',
    errorRing: 'focus-within:ring-danger-text/40',
    errorText: 'text-danger-text',
    labelText: 'text-ink-soft',
    descriptionText: 'text-muted',
    iconColor: 'text-muted',
    iconFocus: 'group-focus-within:text-brand-text',
    hoverText: 'hover:text-brand-text',
    previewBorder: 'border-border-strong',
    presetBorder: 'border-border-strong',
    presetActiveBorder: 'ring-accent-ring border-accent-ring',
}

export default function HostTagManager({ kind }: { readonly kind: HostKind }) {
    const {
        state,
        handler,
        setter,
        form,
        refs: { pickerContainer: pickerContainerRef },
    } = useHostTagManagerLogic(kind)
    const { t } = useTranslationStore()
    return (
        <>
            <CustomTooltip collisionPadding={10} content={t('admin.hostTags.manage')}>
                <button
                    type="button"
                    className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-muted transition-colors hover:border-accent-border hover:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
                    aria-label={t('admin.hostTags.manage')}
                    aria-haspopup="dialog"
                    aria-expanded={state.open}
                    onClick={() => handler.setOpen(true)}
                >
                    <Tags className="size-5" aria-hidden="true" />
                </button>
            </CustomTooltip>
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
                            className="grid items-start gap-3 sm:grid-cols-2"
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
                            <form.Field name="color">
                                {(field) => (
                                    <CustomColorPicker
                                        key={state.editing?.tag.id ?? 'create'}
                                        id={state.formId + '-color'}
                                        name="tagColor"
                                        label={t('admin.hostTags.color')}
                                        value={field.state.value}
                                        onValueChange={field.handleChange}
                                        onBlur={field.handleBlur}
                                        onValidityChange={setter.setIsColorValid}
                                        locale={state.pickerLocale}
                                        messages={state.pickerMessages}
                                        customDesign={pickerDesign}
                                        portalContainer={state.pickerContainer}
                                        classNames={{
                                            popup: 'static! max-h-72! w-full! rounded-xl border border-border bg-surface-raised p-3',
                                        }}
                                        disabled={state.pending}
                                        required
                                    />
                                )}
                            </form.Field>
                            <div ref={pickerContainerRef} className="empty:hidden sm:col-span-2" />
                            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                                <form.Subscribe selector={(formState) => formState.values}>
                                    {(values) => (
                                        <HostTagBadge
                                            tag={{
                                                id: state.formId,
                                                name: values.name || t('admin.hostTags.title'),
                                                color: values.color,
                                            }}
                                        />
                                    )}
                                </form.Subscribe>
                                <button
                                    type="submit"
                                    className={buttonClassName('primary', 'ml-auto')}
                                    disabled={state.pending || !state.isColorValid}
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
                            </div>
                        </form>
                        <ul className="grid gap-2" aria-label={t('admin.hostTags.title')}>
                            {state.tags.map((tag) => (
                                <li
                                    key={tag.id}
                                    className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border p-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <HostTagBadge tag={tag} />
                                    </div>
                                    <button
                                        type="button"
                                        className={buttonClassName('secondary')}
                                        disabled={state.pending || state.editing?.tag.id === tag.id}
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

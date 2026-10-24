import { ModalCancelButton, ModalSaveButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { Tags } from 'lucide-react'
import { Modal } from '@/shared/Modal/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useHostTagAssignmentLogic from '../Hooks/useHostTagAssignmentLogic.ts'
import HostTagSelect from './HostTagSelect.tsx'
import HostTagBadge from './HostTagBadge.tsx'
import type { HostTagsCellProps } from '../Types/host-tags-ui.types.ts'

export default function HostTagsCell(props: HostTagsCellProps) {
    const { state, handler } = useHostTagAssignmentLogic(props)
    const { t } = useTranslationStore()
    return (
        <div className="flex max-w-72 flex-wrap items-center gap-1.5">
            {(props.tags ?? []).map((tag) => (
                <HostTagBadge key={tag.id} tag={tag} />
            ))}
            {!props.tags?.length ? (
                <span className="text-xs text-muted">{t('admin.hostTags.untagged')}</span>
            ) : null}
            {props.canManage ? (
                <button
                    type="button"
                    className={buttonClassName('secondary', 'p-1.5')}
                    onClick={handler.edit}
                    aria-label={t('admin.hostTags.editFor', { name: props.hostLabel })}
                >
                    <Tags className="size-4" aria-hidden="true" />
                </button>
            ) : null}
            {state.open ? (
                <Modal
                    open
                    onOpenChange={handler.setOpen}
                    title={t('admin.hostTags.editFor', { name: props.hostLabel })}
                    description={t('admin.hostTags.assignmentDescription')}
                    size="md"
                    closeDisabled={state.pending}
                    footer={
                        <>
                            <ModalCancelButton
                                disabled={state.pending}
                                onClick={() => handler.setOpen(false)}
                            />
                            <ModalSaveButton
                                type="button"
                                disabled={!state.ready}
                                isPending={state.pending}
                                onClick={handler.save}
                            />
                        </>
                    }
                >
                    <HostTagSelect
                        kind={props.kind}
                        value={state.selected}
                        onChange={handler.select}
                        disabled={state.pending}
                    />
                </Modal>
            ) : null}
        </div>
    )
}

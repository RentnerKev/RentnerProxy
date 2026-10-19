import { Modal } from '@/shared/Modal/index.tsx'
import { Textarea } from '@rentnerkev/inputs'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useApplicationUpdateDialogLogic from '../Hooks/useApplicationUpdateDialogLogic.ts'
import type { ApplicationUpdateDialogProps } from '../Types/application-update-dialog.types.ts'

export default function ApplicationUpdateDialog({
    data,
    open,
    onOpenChange,
}: ApplicationUpdateDialogProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useApplicationUpdateDialogLogic(data)

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={t('updates.title')}
            description={t('updates.description')}
            size="lg"
        >
            <div className="grid gap-6 text-sm leading-relaxed">
                <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-subtle p-4 sm:grid-cols-3">
                    <div>
                        <dt className="text-muted">{t('updates.current')}</dt>
                        <dd className="m-0 font-mono wrap-anywhere">{state.currentVersion}</dd>
                    </div>
                    <div>
                        <dt className="text-muted">{t('updates.target')}</dt>
                        <dd className="m-0 font-mono wrap-anywhere">
                            {data?.latest?.version ?? t('updates.unknown')}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-muted">{t('updates.channel')}</dt>
                        <dd className="m-0">
                            {data?.latest
                                ? t(`updates.channels.${data.latest.channel}`)
                                : t('updates.unknown')}
                        </dd>
                    </div>
                </dl>
                {data?.latest ? (
                    <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
                        <div>
                            <dt className="text-muted">{t('updates.platform')}</dt>
                            <dd className="m-0 font-mono wrap-anywhere">
                                {data.latest.image.platform}
                            </dd>
                        </div>
                        {data.latest.compatibility.minimumVersion ? (
                            <div>
                                <dt className="text-muted">{t('updates.minimumVersion')}</dt>
                                <dd className="m-0 font-mono wrap-anywhere">
                                    {data.latest.compatibility.minimumVersion}
                                </dd>
                            </div>
                        ) : null}
                        {data.latest.compatibility.intermediateVersion ? (
                            <div>
                                <dt className="text-muted">{t('updates.intermediateVersion')}</dt>
                                <dd className="m-0 font-mono wrap-anywhere">
                                    {data.latest.compatibility.intermediateVersion}
                                </dd>
                            </div>
                        ) : null}
                    </dl>
                ) : null}
                <section className="grid gap-2" aria-label={t('updates.availability')}>
                    <h3 className="m-0 font-bold">{t('updates.availability')}</h3>
                    <p className="m-0">
                        {t(data?.latest ? 'updates.published' : 'updates.checkFailed')}
                    </p>
                    <p className="m-0">
                        {t(`updates.images.${data?.latest?.image.status ?? 'unavailable'}`)}
                    </p>
                    <p
                        className={`m-0 rounded-lg border p-3 ${data?.latest?.compatibility.status === 'supported' ? 'border-border' : 'border-amber-500/40 bg-amber-500/10'}`}
                    >
                        {t(
                            `updates.compatibility.${data?.latest?.compatibility.status ?? 'unsupported'}`,
                        )}
                    </p>
                    {data?.latest?.image.reference && state.canCopy ? (
                        <div className="grid gap-2">
                            <label className="font-semibold" htmlFor="update-image-reference">
                                {t('updates.imageReference')}
                            </label>
                            <Textarea
                                id="update-image-reference"
                                readOnly
                                onValueChange={() => undefined}
                                value={data.latest.image.reference}
                                rows={3}
                                className="w-full resize-none rounded-lg border border-border bg-surface p-3 font-mono text-xs"
                            />
                            <button
                                type="button"
                                className={buttonClassName('secondary')}
                                onClick={handler.handleCopy}
                            >
                                {t('updates.copy')}
                            </button>
                            <output className="m-0 text-muted">
                                {state.copyState !== 'idle'
                                    ? t(`updates.copyStates.${state.copyState}`)
                                    : t('updates.copyHint')}
                            </output>
                        </div>
                    ) : null}
                </section>
                <section className="grid gap-2">
                    <h3 className="m-0 font-bold">{t('updates.notes')}</h3>
                    <section
                        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable release notes must support keyboard scrolling.
                        tabIndex={0}
                        aria-label={t('updates.notes')}
                        className="m-0 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 focus-visible:outline-2 focus-visible:outline-accent-ring"
                    >
                        {data?.latest?.notes || t('updates.noNotes')}
                    </section>
                    <a
                        className="w-fit text-accent underline underline-offset-4"
                        href={state.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t('updates.releaseLink')}
                    </a>
                </section>
                <section className="grid gap-3">
                    <h3 className="m-0 font-bold">{t('updates.guideTitle')}</h3>
                    <p className="m-0 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                        {t('updates.interruption')}
                    </p>
                    <ol className="m-0 grid list-decimal gap-4 pl-5">
                        <li>{t('updates.guide.prepare')}</li>
                        <li>
                            {t('updates.guide.backup')}
                            <code className="mt-2 block overflow-x-auto rounded-lg bg-surface-subtle p-3 text-xs">
                                {
                                    'bun run backup:production -- --project <project> --output <directory>'
                                }
                            </code>
                        </li>
                        {data?.latest?.compatibility.status === 'requires-beta1' ? (
                            <li>{t('updates.guide.alpha')}</li>
                        ) : null}
                        <li>{t('updates.guide.image')}</li>
                        <li>{t('updates.guide.verify')}</li>
                    </ol>
                </section>
                <section className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-4">
                    <h3 className="m-0 font-bold">{t('updates.recoveryTitle')}</h3>
                    <p className="m-0">{t('updates.recovery')}</p>
                    <code className="block overflow-x-auto text-xs">
                        {
                            'bun run restore:production -- --project <project> --input <backup> --confirm-replace'
                        }
                    </code>
                    <p className="m-0">{t('updates.restoreValidation')}</p>
                    <p className="m-0">{t('updates.resume')}</p>
                </section>
            </div>
        </Modal>
    )
}

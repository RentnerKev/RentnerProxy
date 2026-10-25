import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { ModalActionButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { Modal } from '@/shared/Modal/index.tsx'
import type { ManualDnsSetupGuideProps } from './Types/manual-dns-setup-guide.types.ts'
import ManualDnsRecordCard from '../../../ManualDnsRecordCard/index.tsx'

export default function ManualDnsSetupGuide(props: ManualDnsSetupGuideProps) {
    const { t, locale } = useTranslationStore()
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            size="md"
            title={t('admin.certificates.manualDns.setup.title')}
            description={t('admin.certificates.manualDns.setup.description')}
            closeDisabled={props.preparing}
            footer={
                <ModalActionButton
                    onClick={props.onDone}
                    disabled={
                        props.preparing ||
                        props.loading ||
                        props.blocked ||
                        (!props.recordsReady && !props.complete)
                    }
                >
                    {t('admin.certificates.manualDns.setup.finish')}
                </ModalActionButton>
            }
        >
            <div className="grid gap-4">
                {props.complete ? (
                    <output className="m-0 text-sm leading-relaxed text-ink-soft">
                        {t('admin.certificates.manualDns.setup.reused')}
                    </output>
                ) : (
                    <>
                        {props.preparing || props.loading ? (
                            <output className="m-0 text-sm leading-relaxed text-muted">
                                {t(
                                    `admin.certificates.manualDns.setup.${props.preparing ? 'preparing' : 'loading'}`,
                                )}
                            </output>
                        ) : null}
                        {props.loadFailed && !props.preparing && !props.loading ? (
                            <button
                                type="button"
                                className={buttonClassName('secondary', 'justify-self-start')}
                                onClick={props.onRetry}
                            >
                                {t('admin.certificates.manualDns.setup.retry')}
                            </button>
                        ) : null}
                        {props.blocked ? (
                            <p className="m-0 text-sm leading-relaxed text-muted">
                                {t('admin.certificates.manualDns.setup.blocked')}
                            </p>
                        ) : null}
                        <p className="m-0 text-sm leading-relaxed text-ink-soft">
                            {t('admin.certificates.manualDns.setup.dnsInstructions')}
                        </p>
                        <p className="m-0 text-xs leading-relaxed text-muted">
                            {t('admin.certificates.manualDns.setup.ownerHint')}
                        </p>
                        <p className="m-0 text-xs leading-relaxed text-muted">
                            {t('admin.certificates.manualDns.setup.valuesHint')}
                        </p>
                        {props.recordsReady
                            ? props.records.map((record, index) => (
                                  <ManualDnsRecordCard
                                      key={`${record.identifier}:${record.owner}:${record.value}`}
                                      record={record}
                                      idPrefix="manual-dns-setup"
                                      index={index}
                                      onCopy={props.onCopy}
                                  />
                              ))
                            : null}
                        {props.recordsReady && props.expiresAt ? (
                            <p className="m-0 text-xs text-muted">
                                {t('admin.certificates.manualDns.setup.expires', {
                                    expires: new Intl.DateTimeFormat(locale, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short',
                                    }).format(new Date(props.expiresAt)),
                                })}
                            </p>
                        ) : null}
                    </>
                )}
            </div>
        </Modal>
    )
}

import { TextInput } from '@rentnerkev/inputs'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { ModalActionButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { Modal } from '@/shared/Modal/index.tsx'
import type { ManualDnsSetupGuideProps } from './Types/manual-dns-setup-guide.types.ts'

export default function ManualDnsSetupGuide(props: ManualDnsSetupGuideProps) {
    const { t } = useTranslationStore()
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
                                  <fieldset
                                      key={`${record.identifier}:${record.owner}:${record.value}`}
                                      className="m-0 grid min-w-0 gap-3 rounded-xl border border-border bg-surface-raised p-3"
                                  >
                                      <legend className="px-1 text-sm font-semibold text-ink-soft">
                                          {record.identifier}
                                      </legend>
                                      <div className="grid gap-1.5">
                                          <label
                                              htmlFor={`manual-dns-setup-owner-${index}`}
                                              className="text-xs font-semibold text-ink-soft"
                                          >
                                              {t('admin.certificates.manualDns.owner')}
                                          </label>
                                          <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
                                              <div className="min-w-0 flex-1">
                                                  <TextInput
                                                      id={`manual-dns-setup-owner-${index}`}
                                                      value={record.owner}
                                                      onValueChange={() => undefined}
                                                      readOnly
                                                  />
                                              </div>
                                              <button
                                                  type="button"
                                                  className={buttonClassName('secondary')}
                                                  onClick={() => void props.onCopy(record.owner)}
                                              >
                                                  {t('admin.certificates.manualDns.copyOwner')}
                                              </button>
                                          </div>
                                      </div>
                                      <div className="grid gap-1.5">
                                          <label
                                              htmlFor={`manual-dns-setup-value-${index}`}
                                              className="text-xs font-semibold text-ink-soft"
                                          >
                                              {t('admin.certificates.manualDns.value')}
                                          </label>
                                          <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
                                              <div className="min-w-0 flex-1">
                                                  <TextInput
                                                      id={`manual-dns-setup-value-${index}`}
                                                      value={record.value}
                                                      onValueChange={() => undefined}
                                                      readOnly
                                                  />
                                              </div>
                                              <button
                                                  type="button"
                                                  className={buttonClassName('secondary')}
                                                  onClick={() => void props.onCopy(record.value)}
                                              >
                                                  {t('admin.certificates.manualDns.copyValue')}
                                              </button>
                                          </div>
                                      </div>
                                  </fieldset>
                              ))
                            : null}
                        {props.recordsReady && props.expiresAt ? (
                            <p className="m-0 text-xs text-muted">
                                {t('admin.certificates.manualDns.setup.expires', {
                                    expires: props.expiresAt,
                                })}
                            </p>
                        ) : null}
                    </>
                )}
            </div>
        </Modal>
    )
}

import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore, {
    useDateTimeFormatter,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import type { DnsSetupInstructionsProps } from '../Types/dns-setup-instructions.types.ts'

export default function DnsSetupInstructions({
    state,
    handler,
    delegated,
    disabled,
}: DnsSetupInstructionsProps) {
    const { t } = useTranslationStore()
    const formatter = useDateTimeFormatter()
    return (
        <section
            className="grid min-w-0 gap-3 border-t border-info-text/20 pt-4"
            aria-labelledby="certificate-dns-setup-records"
        >
            <h3
                id="certificate-dns-setup-records"
                className="m-0 text-sm font-extrabold text-ink-soft"
            >
                {t('admin.certificates.dnsSetup.records')}
            </h3>
            {delegated ? (
                <>
                    <CustomSelect
                        id="certificate-dns-delegation-type"
                        label={t('admin.certificates.dnsSetup.delegationType')}
                        aria-label={t('admin.certificates.dnsSetup.delegationType')}
                        value={state.delegationType}
                        disabled={disabled}
                        onValueChange={handler.changeDelegationType}
                        options={[
                            { value: 'cname', label: 'CNAME' },
                            { value: 'ns', label: 'NS' },
                        ]}
                    />
                    {state.delegationType === 'cname' ? (
                        <div className="grid gap-2">
                            <label
                                htmlFor="certificate-dns-target-owner"
                                className="text-sm font-semibold"
                            >
                                {t('admin.certificates.dnsSetup.targetOwner')}
                            </label>
                            <TextInput
                                id="certificate-dns-target-owner"
                                value={state.targetOwner}
                                onValueChange={handler.changeTargetOwner}
                                disabled={disabled}
                                aria-describedby="certificate-dns-target-hint"
                                aria-invalid={state.targetInvalid}
                            />
                            <p id="certificate-dns-target-hint" className="m-0 text-xs text-muted">
                                {t(
                                    state.targetInvalid
                                        ? 'admin.certificates.errors.dns_delegation_invalid'
                                        : 'admin.certificates.dnsSetup.targetHint',
                                )}
                            </p>
                        </div>
                    ) : (
                        <p className="m-0 text-xs text-muted">
                            {t('admin.certificates.dnsSetup.nsHint')}
                        </p>
                    )}
                </>
            ) : null}
            {state.records.map((record, index) => (
                <fieldset
                    key={`${record.type}:${record.owner}`}
                    className="grid min-w-0 gap-2 rounded-lg border border-info-text/20 p-3"
                >
                    <legend className="px-1 text-xs font-extrabold">{record.type}</legend>
                    <label
                        htmlFor={`certificate-dns-record-owner-${index}`}
                        className="text-xs font-semibold"
                    >
                        {t('admin.certificates.dnsSetup.owner')}
                    </label>
                    <div className="flex min-w-0 gap-2 max-sm:flex-col">
                        <TextInput
                            id={`certificate-dns-record-owner-${index}`}
                            value={record.owner}
                            onValueChange={() => undefined}
                            readOnly
                        />
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={() => void handler.copy(record.owner)}
                            aria-label={`${t('admin.certificates.dnsSetup.copy')} ${t('admin.certificates.dnsSetup.owner')} ${index + 1}`}
                        >
                            {t('admin.certificates.dnsSetup.copy')}
                        </button>
                    </div>
                    {record.values.map((value, valueIndex) => (
                        <div key={value} className="grid min-w-0 gap-1">
                            <label
                                htmlFor={`certificate-dns-record-value-${index}-${valueIndex}`}
                                className="text-xs font-semibold"
                            >
                                {t('admin.certificates.dnsSetup.value')}
                            </label>
                            <div className="flex min-w-0 gap-2 max-sm:flex-col">
                                <TextInput
                                    id={`certificate-dns-record-value-${index}-${valueIndex}`}
                                    value={value}
                                    onValueChange={() => undefined}
                                    readOnly
                                />
                                <button
                                    type="button"
                                    className={buttonClassName('secondary')}
                                    onClick={() => void handler.copy(value)}
                                    aria-label={`${t('admin.certificates.dnsSetup.copy')} ${t('admin.certificates.dnsSetup.value')} ${index + 1}.${valueIndex + 1}`}
                                >
                                    {t('admin.certificates.dnsSetup.copy')}
                                </button>
                            </div>
                        </div>
                    ))}
                    {record.type === 'TXT' ? (
                        <p className="m-0 text-xs text-muted">
                            {t('admin.certificates.dnsSetup.autoTxt')}
                        </p>
                    ) : null}
                    {record.status ? (
                        <output aria-live="polite" className="text-sm text-ink-soft">
                            {t(
                                !delegated && record.status === 'ready'
                                    ? 'admin.certificates.dnsSetup.directReady'
                                    : `admin.certificates.dnsSetup.status.${record.status}`,
                            )}
                        </output>
                    ) : null}
                </fieldset>
            ))}
            <button
                type="button"
                className={buttonClassName('secondary', 'justify-self-start')}
                onClick={() => void handler.check()}
                disabled={!state.canCheck || state.checking}
            >
                {t(
                    `admin.certificates.dnsSetup.${delegated ? (state.checking ? 'checking' : 'check') : state.checking ? 'directChecking' : 'directCheck'}`,
                )}
            </button>
            <p className="m-0 text-xs text-muted">{t('admin.certificates.dnsSetup.readOnly')}</p>
            {state.result ? (
                <p className="m-0 text-xs text-muted">
                    {t('admin.certificates.dnsSetup.checkedAt', {
                        time: formatter.format(new Date(state.result.checkedAt)),
                    })}
                </p>
            ) : null}
        </section>
    )
}

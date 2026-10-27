import useTranslationStore, {
    useDateTimeFormatter,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import type useManualDnsReadOnlyCheck from '../Hooks/useManualDnsReadOnlyCheck.ts'

export default function ManualDnsReadOnlyCheck({
    state,
    handler,
}: ReturnType<typeof useManualDnsReadOnlyCheck>) {
    const { t } = useTranslationStore()
    const formatter = useDateTimeFormatter()
    return (
        <section
            className="grid min-w-0 gap-3 border-t border-info-text/20 pt-3"
            aria-label={t('admin.certificates.dnsSetup.check')}
        >
            <button
                type="button"
                className={buttonClassName('secondary', 'justify-self-start')}
                disabled={!state.canCheck || state.checking}
                onClick={() => void handler.check()}
            >
                {t(`admin.certificates.dnsSetup.${state.checking ? 'checking' : 'check'}`)}
            </button>
            <p className="m-0 text-xs leading-relaxed text-muted">
                {t('admin.certificates.dnsSetup.readOnly')}
            </p>
            {state.expired || state.check ? (
                <output aria-live="polite" className="text-sm font-semibold text-ink-soft">
                    {t(
                        `admin.certificates.dnsSetup.status.${state.expired ? 'expired' : state.check!.status}`,
                    )}
                </output>
            ) : null}
            {state.check && !state.expired ? (
                <>
                    {state.check.records.map((record) => (
                        <div key={record.owner} className="grid min-w-0 gap-1 text-xs">
                            <span className="break-all font-mono text-ink-soft">
                                {record.owner}
                            </span>
                            <span>{t(`admin.certificates.dnsSetup.status.${record.status}`)}</span>
                        </div>
                    ))}
                    <p className="m-0 text-xs text-muted">
                        {t('admin.certificates.dnsSetup.checkedAt', {
                            time: formatter.format(new Date(state.check.checkedAt)),
                        })}
                    </p>
                </>
            ) : null}
        </section>
    )
}

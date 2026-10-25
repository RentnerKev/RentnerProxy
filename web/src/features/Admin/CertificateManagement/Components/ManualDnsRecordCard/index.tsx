import { TextInput } from '@rentnerkev/inputs'
import { Copy } from 'lucide-react'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ManualDnsRecordCardProps } from './Types/manual-dns-record-card.types.ts'

export default function ManualDnsRecordCard({
    record,
    idPrefix,
    index,
    onCopy,
}: ManualDnsRecordCardProps) {
    const { t } = useTranslationStore()
    return (
        <fieldset className="m-0 grid min-w-0 gap-4 rounded-xl border border-border bg-surface p-4">
            <legend className="break-all px-1 text-sm font-semibold text-ink-soft">
                {record.identifier}
            </legend>
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label
                    htmlFor={`${idPrefix}-owner-${index}`}
                    className="text-xs font-semibold text-ink-soft sm:col-span-2"
                >
                    {t('admin.certificates.manualDns.owner')}
                </label>
                <div className="min-w-0">
                    <TextInput
                        id={`${idPrefix}-owner-${index}`}
                        value={record.owner}
                        onValueChange={() => undefined}
                        readOnly
                    />
                </div>
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    onClick={() => void onCopy(record.owner)}
                >
                    <Copy className="size-4" aria-hidden="true" />
                    {t('admin.certificates.manualDns.copyOwner')}
                </button>
                <label
                    htmlFor={`${idPrefix}-value-${index}`}
                    className="mt-2 text-xs font-semibold text-ink-soft sm:col-span-2"
                >
                    {t('admin.certificates.manualDns.value')}
                </label>
                <div className="min-w-0">
                    <TextInput
                        id={`${idPrefix}-value-${index}`}
                        value={record.value}
                        onValueChange={() => undefined}
                        readOnly
                    />
                </div>
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    onClick={() => void onCopy(record.value)}
                >
                    <Copy className="size-4" aria-hidden="true" />
                    {t('admin.certificates.manualDns.copyValue')}
                </button>
            </div>
        </fieldset>
    )
}

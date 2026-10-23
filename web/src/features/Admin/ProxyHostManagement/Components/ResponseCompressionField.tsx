import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHttpSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export default function ResponseCompressionField({
    id,
    value,
    onChange,
    disabled,
    global = false,
    inherited,
}: {
    readonly id: string
    readonly value: ProxyHttpSettings['responseCompression'] | null
    readonly onChange: (value: ProxyHttpSettings['responseCompression']) => void
    readonly disabled: boolean
    readonly global?: boolean
    readonly inherited?: ProxyHttpSettings['responseCompression']
}) {
    const { t } = useTranslationStore()
    return (
        <div
            className="grid min-w-0 gap-2"
            data-setting="responseCompression"
            data-setting-source={value == null ? 'inherited' : 'override'}
        >
            <label htmlFor={id} className="text-sm font-bold text-ink-soft">
                {t('admin.proxyHosts.config.compression.title')}
            </label>
            <CustomSelect
                id={id}
                value={value ?? 'inherit'}
                disabled={disabled}
                aria-label={t('admin.proxyHosts.config.compression.title')}
                aria-describedby={`${id}-hint`}
                options={[
                    {
                        value: 'inherit',
                        label: t(
                            `admin.proxyHosts.config.compression.${global ? 'default' : 'inherit'}`,
                        ),
                    },
                    { value: 'auto', label: t('admin.proxyHosts.config.compression.auto') },
                    { value: 'off', label: t('admin.proxyHosts.config.compression.off') },
                ]}
                onValueChange={(next) =>
                    onChange(next === 'auto' || next === 'off' ? next : undefined)
                }
            />
            <p id={`${id}-hint`} className="m-0 text-xs text-muted">
                {t('admin.proxyHosts.config.compression.hint')}
                {!global && value == null && inherited
                    ? ` ${t('admin.proxyHosts.config.compression.effective', { mode: t(`admin.proxyHosts.config.compression.${inherited}`) })}`
                    : null}
            </p>
        </div>
    )
}

import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import { NumberInput, TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import useBrowserCacheFieldsLogic from './Hooks/useBrowserCacheFieldsLogic.ts'
import type { BrowserCacheFieldsProps } from './Types/browser-cache-fields.types.ts'

export default function BrowserCacheFields(props: BrowserCacheFieldsProps) {
    const { value, disabled } = props
    const { t } = useTranslationStore()
    const {
        state: { id, invalid },
        handler,
    } = useBrowserCacheFieldsLogic(props)
    return (
        <fieldset
            disabled={disabled}
            className="grid gap-3 rounded-xl border border-border p-3 shell:col-span-2"
        >
            <legend className="font-bold">{t('admin.proxyHosts.browserCache.title')}</legend>
            <p id={id + '-help'} className="text-sm text-muted">
                {t('admin.proxyHosts.browserCache.help')}
            </p>
            <OptionToggle
                label={t('admin.proxyHosts.browserCache.enable')}
                checked={value?.enabled ?? false}
                disabled={disabled}
                aria-describedby={id + '-help'}
                onChange={(event) => handler.setEnabled(event.target.checked)}
            />
            {invalid ? (
                <p role="alert" className="text-sm text-danger-text">
                    {t('admin.proxyHosts.browserCache.invalid')}
                </p>
            ) : null}
            {value?.rules.map((rule, index) => (
                <div
                    key={handler.getRuleKey(index)}
                    className="grid gap-2 rounded-lg border border-border p-2"
                >
                    <label htmlFor={id + '-path-' + index}>
                        {t('admin.proxyHosts.browserCache.path')}
                    </label>
                    <TextInput
                        id={id + '-path-' + index}
                        value={rule.path}
                        maxLength={512}
                        placeholder="/assets/app.a1b2.js"
                        onChange={(event) =>
                            handler.updateRule(index, { path: event.target.value })
                        }
                    />
                    <label htmlFor={id + '-age-' + index}>
                        {t('admin.proxyHosts.browserCache.age')}
                    </label>
                    <NumberInput
                        type="number"
                        id={id + '-age-' + index}
                        min={1}
                        max={31536000}
                        value={String(rule.maxAgeSeconds)}
                        onChange={(event) =>
                            handler.updateRule(index, { maxAgeSeconds: Number(event.target.value) })
                        }
                    />
                    <OptionToggle
                        label={t('admin.proxyHosts.browserCache.immutable')}
                        checked={rule.immutable}
                        disabled={disabled}
                        onChange={(event) =>
                            handler.updateRule(index, { immutable: event.target.checked })
                        }
                    />
                    <button
                        className={buttonClassName('secondary')}
                        type="button"
                        onClick={() => handler.removeRule(index)}
                    >
                        {t('admin.proxyHosts.browserCache.remove')}
                    </button>
                </div>
            ))}
            <button
                className={buttonClassName('secondary')}
                type="button"
                disabled={disabled || (value?.rules.length ?? 0) >= 20}
                onClick={handler.addRule}
            >
                {t('admin.proxyHosts.browserCache.add')}
            </button>
        </fieldset>
    )
}

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
        state: { id, invalid, rules },
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
                <p id={id + '-error'} role="alert" className="text-sm text-danger-text">
                    {t('admin.proxyHosts.browserCache.invalid')}
                </p>
            ) : null}
            {value?.enabled
                ? rules.map((rule, index) => (
                      <div
                          key={rule.key}
                          className="grid gap-2 rounded-lg border border-border p-2"
                      >
                          <label htmlFor={id + '-path-' + index}>
                              {t('admin.proxyHosts.browserCache.path')}
                          </label>
                          <TextInput
                              id={id + '-path-' + index}
                              value={rule.path}
                              disabled={disabled}
                              required
                              maxLength={512}
                              aria-invalid={invalid}
                              aria-describedby={invalid ? id + '-error' : id + '-help'}
                              validationMode="external"
                              placeholder={t('admin.proxyHosts.browserCache.pathPlaceholder')}
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
                              placeholder={t('placeholders.browserCacheMaxAge')}
                              min={1}
                              max={31536000}
                              step={1}
                              value={rule.maxAgeValue}
                              disabled={disabled}
                              required
                              aria-invalid={invalid}
                              aria-describedby={invalid ? id + '-error' : id + '-help'}
                              validationMode="external"
                              onValueChange={(draft) => handler.setMaxAge(index, draft)}
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
                              disabled={disabled}
                              onClick={() => handler.removeRule(index)}
                          >
                              {t('admin.proxyHosts.browserCache.remove')}
                          </button>
                      </div>
                  ))
                : null}
            <button
                className={buttonClassName('secondary')}
                type="button"
                disabled={disabled || !value?.enabled || rules.length >= 20}
                onClick={handler.addRule}
            >
                {t('admin.proxyHosts.browserCache.add')}
            </button>
        </fieldset>
    )
}

import { CheckboxInput, NumberInput, TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useResponseCacheFieldsLogic from '../Hooks/useResponseCacheFieldsLogic.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'

export default function ResponseCacheFields({
    form,
    formId,
    isPending,
}: Pick<ProxyHostFormFieldsProps, 'form' | 'formId' | 'isPending'>) {
    const { t } = useTranslationStore()
    const { state, handler } = useResponseCacheFieldsLogic({ form })
    return (
        <fieldset className="grid gap-3 rounded-[0.7rem] border border-border p-3 shell:col-span-full">
            <legend className="text-sm font-bold">
                {t('admin.proxyHosts.responseCache.title')}
            </legend>
            <label className="flex items-center gap-2" htmlFor={`${formId}-response-cache`}>
                <CheckboxInput
                    id={`${formId}-response-cache`}
                    type="checkbox"
                    checked={Boolean(state.settings)}
                    disabled={isPending}
                    onChange={(event) => handler.handleEnabled(event.target.checked)}
                />
                <span>{t('admin.proxyHosts.responseCache.enabled')}</span>
            </label>
            <p className="m-0 text-xs leading-relaxed text-muted">
                {t('admin.proxyHosts.responseCache.hint')}
            </p>
            {state.settings ? (
                <>
                    <label
                        className="grid gap-1 text-sm"
                        htmlFor={`${formId}-response-cache-paths`}
                    >
                        {t('admin.proxyHosts.responseCache.paths')}
                        <TextInput
                            id={`${formId}-response-cache-paths`}
                            type="text"
                            disabled={isPending}
                            aria-invalid={state.invalid}
                            aria-describedby={`${formId}-response-cache-error`}
                            value={state.settings.pathPrefixes.join(', ')}
                            onChange={(event) => handler.handlePrefixes(event.target.value)}
                        />
                    </label>
                    <label className="grid gap-1 text-sm" htmlFor={`${formId}-response-cache-ttl`}>
                        {t('admin.proxyHosts.responseCache.ttl')}
                        <NumberInput
                            id={`${formId}-response-cache-ttl`}
                            type="number"
                            min={1}
                            max={3600}
                            disabled={isPending}
                            aria-invalid={state.invalid}
                            aria-describedby={`${formId}-response-cache-error`}
                            value={String(state.settings.ttlSeconds)}
                            onChange={(event) => handler.handleTtl(event.target.value)}
                        />
                    </label>
                    {state.invalid ? (
                        <p
                            id={`${formId}-response-cache-error`}
                            role="alert"
                            className="m-0 text-xs text-danger"
                        >
                            {t('admin.proxyHosts.responseCache.invalid')}
                        </p>
                    ) : null}
                </>
            ) : null}
        </fieldset>
    )
}

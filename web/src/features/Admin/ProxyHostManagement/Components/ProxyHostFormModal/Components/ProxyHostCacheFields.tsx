import ResponseCompressionField from '../../ResponseCompressionField.tsx'
import ResponseCacheFields from './ResponseCacheFields.tsx'
import BrowserCacheFields from '../../BrowserCacheFields/index.tsx'
import type { ProxyHostCacheFieldsProps } from '../Types/form-sections.types.ts'

export default function ProxyHostCacheFields({
    form,
    formId,
    isPending,
    canConfigureCompression,
    canConfigureBrowserCache,
    canApplyResponseCache,
    handleBrowserCacheChange,
}: ProxyHostCacheFieldsProps) {
    return (
        <>
            <form.Field name="responseCompression">
                {(field) => (
                    <div className="shell:col-span-full">
                        <ResponseCompressionField
                            id={`${formId}-responseCompression`}
                            value={field.state.value}
                            disabled={isPending || !canConfigureCompression}
                            onChange={(value) => field.handleChange(value ?? null)}
                        />
                    </div>
                )}
            </form.Field>
            {canApplyResponseCache ? (
                <ResponseCacheFields form={form} formId={formId} isPending={isPending} />
            ) : null}
            <form.Field name="browserCache">
                {(field) => (
                    <BrowserCacheFields
                        value={field.state.value}
                        onChange={handleBrowserCacheChange}
                        disabled={isPending || !canConfigureBrowserCache}
                    />
                )}
            </form.Field>
        </>
    )
}

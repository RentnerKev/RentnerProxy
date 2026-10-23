import { useStore } from '@tanstack/react-form'
import { responseCacheSchema } from '@/lib/ResponseCache/responseCache.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'

export default function useResponseCacheFieldsLogic({
    form,
}: Pick<ProxyHostFormFieldsProps, 'form'>) {
    const settings = useStore(form.store, (state) => state.values.responseCache)
    const attempts = useStore(form.store, (state) => state.submissionAttempts)
    return {
        state: {
            settings,
            invalid:
                attempts > 0 &&
                settings != null &&
                !responseCacheSchema.safeParse(settings).success,
        },
        handler: {
            handleEnabled: (enabled: boolean) =>
                form.setFieldValue(
                    'responseCache',
                    enabled ? { pathPrefixes: ['/assets/'], ttlSeconds: 60 } : null,
                ),
            handlePrefixes: (value: string) => {
                if (settings)
                    form.setFieldValue('responseCache', {
                        ...settings,
                        pathPrefixes: value.split(',').map((path) => path.trim()),
                    })
            },
            handleTtl: (value: string) => {
                if (settings)
                    form.setFieldValue('responseCache', { ...settings, ttlSeconds: Number(value) })
            },
        },
    }
}

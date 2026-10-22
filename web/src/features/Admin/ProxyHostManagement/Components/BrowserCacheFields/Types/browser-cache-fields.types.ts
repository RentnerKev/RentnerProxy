import type { BrowserCacheSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface BrowserCacheFieldsProps {
    readonly value: BrowserCacheSettings | undefined
    readonly onChange: (value: BrowserCacheSettings) => void
    readonly disabled: boolean
}

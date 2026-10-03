import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export type DefaultSiteSaveResult =
    | {
          readonly success: true
          readonly message: string
          readonly runtimeStatus: ProxyRuntimeMutationStatus
      }
    | { readonly success: false; readonly message: string }

export type DefaultSiteFormatResult =
    | { readonly success: true; readonly html: string }
    | { readonly success: false; readonly message: string }

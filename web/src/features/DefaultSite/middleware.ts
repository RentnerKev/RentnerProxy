import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { z } from 'zod'

import {
    getDefaultSiteService,
    saveDefaultSiteService,
} from '@/server/DefaultSite/default-site.service.ts'
import { DefaultSiteError } from '@/server/DefaultSite/default-site.errors.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import type { ProxyRuntimeMutationStatus } from '@/shared/Types/proxy-runtime.types.ts'

export type DefaultSiteSaveResult =
    | {
          readonly success: true
          readonly message: string
          readonly runtimeStatus: ProxyRuntimeMutationStatus
      }
    | { readonly success: false; readonly message: string }

export const getDefaultSiteHandler = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeader('Cache-Control', 'no-store')
    try {
        return await getDefaultSiteService()
    } catch (error) {
        throwLocalizedQueryError(error, 'defaultSite.errors.loadFailed')
    }
})

export const saveDefaultSiteHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => input)
    .handler(async ({ data }): Promise<DefaultSiteSaveResult> => {
        setResponseHeader('Cache-Control', 'no-store')
        try {
            const runtimeStatus = await saveDefaultSiteService(data)
            return {
                success: true,
                runtimeStatus,
                message:
                    runtimeStatus === 'applied' ? 'defaultSite.saved' : 'defaultSite.savedPending',
            }
        } catch (error) {
            if (error instanceof DefaultSiteError) {
                setResponseStatus(409)
                return { success: false, message: 'defaultSite.errors.conflict' }
            }
            if (error instanceof z.ZodError) {
                setResponseStatus(400)
                return { success: false, message: 'defaultSite.errors.invalidSettings' }
            }
            return localizedActionFailure(error, 'defaultSite.errors.saveFailed')
        }
    })

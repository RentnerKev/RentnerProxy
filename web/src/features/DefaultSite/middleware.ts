import type { DefaultSiteFormatResult, DefaultSiteSaveResult } from './Types/middleware.types.ts'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { z } from 'zod'

import {
    getDefaultSiteService,
    saveDefaultSiteService,
} from '@/server/DefaultSite/default-site.service.ts'
import {
    DefaultSiteError,
    DefaultSiteHtmlFormatError,
} from '@/server/DefaultSite/default-site.errors.ts'
import { formatDefaultSiteHtmlService } from '@/server/DefaultSite/format-default-site-html.service.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'

export const getDefaultSiteHandler = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeader('Cache-Control', 'no-store')
    try {
        return await getDefaultSiteService()
    } catch (error) {
        throwLocalizedQueryError(error, 'defaultSite.errors.loadFailed')
    }
})

export const formatDefaultSiteHtmlHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => input)
    .handler(async ({ data }): Promise<DefaultSiteFormatResult> => {
        setResponseHeader('Cache-Control', 'no-store')
        try {
            return { success: true, html: await formatDefaultSiteHtmlService(data) }
        } catch (error) {
            if (error instanceof DefaultSiteHtmlFormatError || error instanceof z.ZodError) {
                setResponseStatus(400)
                return { success: false, message: 'defaultSite.editor.formatFailed' }
            }
            return localizedActionFailure(error, 'defaultSite.editor.formatFailed')
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

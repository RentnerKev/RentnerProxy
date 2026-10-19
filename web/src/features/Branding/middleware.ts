import { createServerOnlyFn } from '@tanstack/react-start'
import { getMailLogoResponseService } from '@/server/Mail/mail-logo.service.ts'

export const getMailLogoResponseHandler = createServerOnlyFn(getMailLogoResponseService)

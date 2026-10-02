import { createServerOnlyFn } from '@tanstack/react-start'

import { checkFoundationReadinessService } from '@/server/Foundation/health.service.ts'

export const getFoundationReadinessHandler = createServerOnlyFn(async () => {
    return checkFoundationReadinessService()
})

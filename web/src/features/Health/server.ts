import { createServerOnlyFn } from '@tanstack/react-start'

import { checkFoundationReadiness } from '../../server/Foundation/health.service'

export const getFoundationReadiness = createServerOnlyFn(async () => {
    return checkFoundationReadiness()
})

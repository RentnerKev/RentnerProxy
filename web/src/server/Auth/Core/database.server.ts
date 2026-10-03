import '@tanstack/react-start/server-only'

import { db } from '@/db/index.ts'

export function getAuthDatabase() {
    return db
}

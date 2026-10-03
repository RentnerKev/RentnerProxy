import '@tanstack/react-start/server-only'

import { deriveWebAuthnRpId, getPublicOrigin } from '@/server/env.server.ts'
import type { WebAuthnConfiguration } from '@/server/Types/env.types.ts'

export async function getRuntimeWebAuthnConfiguration(): Promise<WebAuthnConfiguration | null> {
    const origin = getPublicOrigin()
    if (!origin) return null
    const rpId = deriveWebAuthnRpId(origin)
    return rpId ? { origin, rpId, rpName: 'RentnerProxy' } : null
}

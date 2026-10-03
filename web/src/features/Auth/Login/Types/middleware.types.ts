import type { AuthActionResult } from '@/server/Auth/Types/auth-transport.types.ts'

export type TwoFactorLoginActionResult = AuthActionResult & {
    readonly restartLogin?: boolean
}

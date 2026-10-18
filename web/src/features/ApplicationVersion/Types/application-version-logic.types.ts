import type { ApplicationUpdateResult } from './application-update.types.ts'

export interface ApplicationVersionProps {
    readonly data: ApplicationUpdateResult | undefined
    readonly onOpen: () => void
}

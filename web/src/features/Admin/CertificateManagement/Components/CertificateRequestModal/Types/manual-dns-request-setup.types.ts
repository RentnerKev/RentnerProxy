import type { RequestCertificateInput } from '../../../Types/validation.types.ts'

export interface ManualDnsRequestSetupInputs {
    readonly enabled: boolean
    readonly getInput: () => RequestCertificateInput
    readonly reportValidationError: () => void
    readonly onSuccess: (certificateId?: string) => void | Promise<void>
}

export interface PreparedManualDnsRequest {
    readonly certificateId: string
    readonly input: RequestCertificateInput
    readonly operationId: string | null
    readonly challengeSetId: string | null
}

import type { z } from 'zod'
import type {
    domainDiagnosticsInputSchema,
    domainDiagnosticsControllerInputSchema,
    domainDiagnosticsResultSchema,
} from '../domainDiagnostics.ts'
export type DomainDiagnosticsInput = z.infer<typeof domainDiagnosticsInputSchema>
export type DomainDiagnosticsControllerInput = z.infer<
    typeof domainDiagnosticsControllerInputSchema
>
export type DomainDiagnosticsResult = z.infer<typeof domainDiagnosticsResultSchema>

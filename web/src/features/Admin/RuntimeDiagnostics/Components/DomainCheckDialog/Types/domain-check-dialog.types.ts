import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type {
    DomainDiagnosticsInput,
    DomainDiagnosticsResult,
} from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import type { DomainCheckStageName } from '@/lib/RuntimeDiagnostics/Types/domain-check.types.ts'

export interface DomainCheckDialogProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly hostType: DomainDiagnosticsInput['hostType']
    readonly host: {
        readonly id: string
        readonly domains: readonly string[]
        readonly updatedAt: Date
        readonly enabled: boolean
    }
    readonly permissions: readonly PermissionKey[]
}

export interface DomainCheckAttempt {
    readonly input: DomainDiagnosticsInput
    readonly key: string
    readonly sequence: number
    readonly signal: AbortSignal
}

export interface DomainCheckStageView {
    readonly name: DomainCheckStageName
    readonly title: string
    readonly description: string
    readonly advice: string
    readonly status: DomainDiagnosticsResult['stages'][DomainCheckStageName]['status'] | 'pending'
    readonly statusLabel: string
    readonly addresses: readonly string[]
    readonly detail: string | null
}

export interface DomainCheckStageProps {
    readonly stage: DomainCheckStageView
}

export interface DomainCheckDialogLogic {
    readonly state: {
        readonly canCheck: boolean
        readonly domain: string
        readonly domainOptions: readonly { readonly value: string; readonly label: string }[]
        readonly selectLocale: 'de' | 'en' | 'es' | 'fr'
        readonly isPending: boolean
        readonly result: DomainDiagnosticsResult | null
        readonly checkedAt: string | null
        readonly stages: readonly DomainCheckStageView[]
        readonly error: string | null
        readonly notice: string | null
        readonly copyFeedback: string | null
    }
    readonly handler: {
        readonly handleDomainChange: (domain: string) => void
        readonly handleCheck: () => void
        readonly handleCancel: () => void
        readonly handleOpenChange: (open: boolean) => void
        readonly handleCopy: () => void
    }
}

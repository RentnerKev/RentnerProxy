import type useDnsSetupInspection from '../Hooks/useDnsSetupInspection.ts'

export type DnsSetupInstructionsProps = ReturnType<typeof useDnsSetupInspection> & {
    readonly delegated: boolean
    readonly disabled: boolean
}

import type { ManagedDomainOverflowLogicResult } from '../Types/managed-domain.types.ts'

export default function useManagedDomainOverflowLogic(): ManagedDomainOverflowLogicResult {
    return {
        handler: {
            handleStopPropagation: (event) => event.stopPropagation(),
        },
    }
}

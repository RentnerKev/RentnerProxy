import useFoundationStatusViewLogic from './Hooks/useFoundationStatusViewLogic.ts'
import type { FoundationStatusProps } from '../../Types/foundation-status.types.ts'
import CompactFoundationStatus from '../CompactFoundationStatus.tsx'
import FullFoundationStatus from '../FullFoundationStatus.tsx'

export default function FoundationStatus({
    compact = false,
    health,
    liveStatus,
}: FoundationStatusProps) {
    const { state: viewModel } = useFoundationStatusViewLogic({ health, liveStatus })

    return compact ? (
        <CompactFoundationStatus {...viewModel} />
    ) : (
        <FullFoundationStatus {...viewModel} />
    )
}

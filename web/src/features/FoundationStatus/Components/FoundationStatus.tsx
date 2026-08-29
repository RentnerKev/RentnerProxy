import createFoundationStatusViewModel from '../Helpers/createFoundationStatusViewModel'
import type { FoundationStatusProps } from '../Types/foundation-status.types'
import CompactFoundationStatus from './CompactFoundationStatus'
import FullFoundationStatus from './FullFoundationStatus'

export default function FoundationStatus({ compact = false, health }: FoundationStatusProps) {
    const viewModel = createFoundationStatusViewModel(health)

    return compact ? (
        <CompactFoundationStatus {...viewModel} />
    ) : (
        <FullFoundationStatus {...viewModel} />
    )
}

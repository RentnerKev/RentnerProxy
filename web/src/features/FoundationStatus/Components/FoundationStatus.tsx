import useTranslationStore from '../../../language/useTranslationStore'
import createFoundationStatusViewModel from '../Helpers/createFoundationStatusViewModel'
import type { FoundationStatusProps } from '../Types/foundation-status.types'
import CompactFoundationStatus from './CompactFoundationStatus'
import FullFoundationStatus from './FullFoundationStatus'

export default function FoundationStatus({
    compact = false,
    health,
    liveStatus,
}: FoundationStatusProps) {
    const { t } = useTranslationStore()
    const viewModel = createFoundationStatusViewModel(health, t, liveStatus)

    return compact ? (
        <CompactFoundationStatus {...viewModel} />
    ) : (
        <FullFoundationStatus {...viewModel} />
    )
}

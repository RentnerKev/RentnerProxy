import useTranslationStore from '../../../language/useTranslationStore'
import createFoundationStatusViewModel from '../Helpers/createFoundationStatusViewModel'
import type { FoundationStatusProps } from '../Types/foundation-status.types'
import CompactFoundationStatus from './CompactFoundationStatus'
import FullFoundationStatus from './FullFoundationStatus'

export default function FoundationStatus({ compact = false, health }: FoundationStatusProps) {
    const { t } = useTranslationStore()
    const viewModel = createFoundationStatusViewModel(health, t)

    return compact ? (
        <CompactFoundationStatus {...viewModel} />
    ) : (
        <FullFoundationStatus {...viewModel} />
    )
}

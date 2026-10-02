import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import createFoundationStatusViewModel from '@/lib/FoundationStatus/createFoundationStatusViewModel.ts'
import type {
    FoundationStatusProps,
    FoundationStatusViewLogicResult,
} from '../../../Types/foundation-status.types.ts'

export default function useFoundationStatusViewLogic({
    health,
    liveStatus,
}: FoundationStatusProps): FoundationStatusViewLogicResult {
    const { t } = useTranslationStore()
    return { state: createFoundationStatusViewModel(health, t, liveStatus) }
}

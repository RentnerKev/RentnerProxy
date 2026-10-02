import type {
    CrowdSecTransition,
    CrowdSecTransitionProgress,
} from '../../../Types/crowdsec.types.ts'

export interface CrowdSecTransitionModalProps {
    readonly transition: CrowdSecTransition
    readonly progress: CrowdSecTransitionProgress
    readonly onClose: () => void
}

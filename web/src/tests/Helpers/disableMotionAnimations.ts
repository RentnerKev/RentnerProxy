import { MotionGlobalConfig } from 'motion-utils'

export default function disableMotionAnimations(): void {
    MotionGlobalConfig.skipAnimations = true
}

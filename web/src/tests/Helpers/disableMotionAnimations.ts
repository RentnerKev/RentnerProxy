import { MotionGlobalConfig } from 'motion/react'

export default function disableMotionAnimations(): void {
    MotionGlobalConfig.skipAnimations = true
}

import type { ProfileImageLogicResult } from './profile-image-logic.types.ts'

export interface ProfileImageCropDialogProps {
    readonly state: ProfileImageLogicResult['state']
    readonly handler: ProfileImageLogicResult['handler']
}

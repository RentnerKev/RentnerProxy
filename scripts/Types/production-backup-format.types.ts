import type { z } from 'zod'

import type { deploymentSchema } from '../production-backup.validation.ts'

export type DeploymentSettings = z.infer<typeof deploymentSchema>

export type StateArchiveEntry = Readonly<{
    name: string
    directory: boolean
    bytes: Uint8Array
}>

import type { metadataSchema } from '../production-backup.validation.ts'

export type BackupMetadata = z.infer<typeof metadataSchema>

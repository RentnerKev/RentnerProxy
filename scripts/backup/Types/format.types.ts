import type { z } from 'zod'

import type { deploymentSchema } from '../validation.ts'

export type DeploymentSettings = z.infer<typeof deploymentSchema>

export type StateArchiveEntry = Readonly<{
    name: string
    directory: boolean
    bytes: Uint8Array
}>

import type { metadataSchema } from '../validation.ts'

export type BackupMetadata = z.infer<typeof metadataSchema>

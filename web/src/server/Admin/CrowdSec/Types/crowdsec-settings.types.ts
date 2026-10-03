import type { z } from 'zod'
import type { storedCrowdSecConfigurationSchema } from '../crowdsec-settings.validation.ts'

export type StoredCrowdSecConfiguration = z.infer<typeof storedCrowdSecConfigurationSchema>
export type EncryptedCrowdSecApiKey = NonNullable<StoredCrowdSecConfiguration['external']>['apiKey']

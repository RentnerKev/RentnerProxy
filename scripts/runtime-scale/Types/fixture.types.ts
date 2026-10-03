import type { z } from 'zod'
import type { inventorySchema } from '../fixture.validation.ts'

export type Inventory = z.output<typeof inventorySchema>

export type ExpectedHost = Inventory['hosts'][number]

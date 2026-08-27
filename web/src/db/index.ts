import { pgSchema } from 'drizzle-orm/pg-core'

import { defineSystemSettings } from './Schema/system-settings'

export const rentnerProxySchema = pgSchema('rentnerproxy')
export const systemSettings = defineSystemSettings(rentnerProxySchema)

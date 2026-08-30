import { customType } from 'drizzle-orm/pg-core'

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
    dataType: () => 'bytea',
    fromDriver: (value) => new Uint8Array(value),
    toDriver: (value) => value,
})

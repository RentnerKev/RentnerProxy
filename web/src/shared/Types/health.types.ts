export type ServiceHealth = Readonly<{
    state: 'connected' | 'unavailable'
}>

export type FoundationHealth = Readonly<{
    controller: ServiceHealth
    database: ServiceHealth
    redis: ServiceHealth
}>

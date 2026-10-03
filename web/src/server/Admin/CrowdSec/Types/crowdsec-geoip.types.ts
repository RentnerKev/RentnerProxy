import type maxmind from 'maxmind'

export type GeoReader = Awaited<ReturnType<typeof maxmind.open>>

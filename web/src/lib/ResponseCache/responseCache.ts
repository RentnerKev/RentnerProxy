import { z } from 'zod'

const reservedSegments = new Set(['api', 'auth', 'admin', 'login', 'logout', 'oauth', 'session'])

export const responseCacheSchema = z.strictObject({
    pathPrefixes: z
        .array(
            z
                .string()
                .min(2)
                .max(256)
                .regex(/^\/(?:[A-Za-z0-9_-]+\/)+$/u)
                .refine((path) => !reservedSegments.has(path.split('/')[1]?.toLowerCase() ?? '')),
        )
        .min(1)
        .max(16)
        .refine((paths) => new Set(paths).size === paths.length),
    ttlSeconds: z.number().int().min(1).max(3_600),
})

import { z } from 'zod'

import { OPAQUE_TOKEN_PATTERN } from '../../../config/auth.config'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const credentialIdSchema = z.string().min(1).max(2_048).regex(BASE64URL_PATTERN)
const clientDataSchema = z.string().min(1).max(32_768).regex(BASE64URL_PATTERN)
const authenticatorDataSchema = z.string().min(1).max(16_384).regex(BASE64URL_PATTERN)
const signatureSchema = z.string().min(1).max(16_384).regex(BASE64URL_PATTERN)
const attestationObjectSchema = z.string().min(1).max(262_144).regex(BASE64URL_PATTERN)
const authenticatorAttachmentSchema = z.enum(['cross-platform', 'platform']).optional()

export const opaqueAuthChallengeSchema = z.string().regex(OPAQUE_TOKEN_PATTERN)

export const authenticationResponseSchema = z
    .object({
        authenticatorAttachment: authenticatorAttachmentSchema,
        clientExtensionResults: z.unknown(),
        id: credentialIdSchema,
        rawId: credentialIdSchema,
        response: z.object({
            authenticatorData: authenticatorDataSchema,
            clientDataJSON: clientDataSchema,
            signature: signatureSchema,
            userHandle: credentialIdSchema.nullable().optional(),
        }),
        type: z.literal('public-key'),
    })
    .refine((credential) => credential.id === credential.rawId, {
        message: 'Credential identifiers do not match.',
        path: ['rawId'],
    })

export const registrationResponseSchema = z
    .object({
        authenticatorAttachment: authenticatorAttachmentSchema,
        clientExtensionResults: z.unknown(),
        id: credentialIdSchema,
        rawId: credentialIdSchema,
        response: z.object({
            attestationObject: attestationObjectSchema,
            clientDataJSON: clientDataSchema,
            transports: z
                .array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']))
                .max(8)
                .optional(),
        }),
        type: z.literal('public-key'),
    })
    .refine((credential) => credential.id === credential.rawId, {
        message: 'Credential identifiers do not match.',
        path: ['rawId'],
    })

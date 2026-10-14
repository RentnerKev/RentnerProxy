import { z } from 'zod'
import type {
    AuthenticationExtensionsClientOutputs,
    AuthenticationResponseJSON,
    RegistrationResponseJSON,
} from '@simplewebauthn/server'

import { OPAQUE_TOKEN_PATTERN } from '@/config/auth.config.ts'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const credentialIdSchema = z.string().min(1).max(2_048).regex(BASE64URL_PATTERN)
const clientDataSchema = z.string().min(1).max(32_768).regex(BASE64URL_PATTERN)
const authenticatorDataSchema = z.string().min(1).max(16_384).regex(BASE64URL_PATTERN)
const signatureSchema = z.string().min(1).max(16_384).regex(BASE64URL_PATTERN)
const attestationObjectSchema = z.string().min(1).max(262_144).regex(BASE64URL_PATTERN)
const authenticatorTransportSchema = z.string().min(1).max(64)
const authenticatorAttachmentSchema = z.enum(['cross-platform', 'platform']).optional()
const bufferSourceSchema = z.custom<ArrayBuffer | ArrayBufferView>(
    (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value),
    { message: 'Expected a WebAuthn buffer source.' },
)
const clientExtensionResultsSchema = z.unknown().pipe(
    z
        .looseObject({
            appid: z.boolean().optional(),
            credProps: z
                .looseObject({ rk: z.boolean().optional() })
                .transform(({ rk, ...properties }) => ({
                    ...properties,
                    ...(rk === undefined ? {} : { rk }),
                }))
                .optional(),
            hmacCreateSecret: z.boolean().optional(),
            prf: z
                .looseObject({
                    enabled: z.boolean().optional(),
                    results: z
                        .object({
                            first: bufferSourceSchema,
                            second: bufferSourceSchema.optional(),
                        })
                        .transform(({ first, second }) => ({
                            first,
                            ...(second === undefined ? {} : { second }),
                        }))
                        .optional(),
                })
                .transform(({ enabled, results, ...properties }) => ({
                    ...properties,
                    ...(enabled === undefined ? {} : { enabled }),
                    ...(results === undefined ? {} : { results }),
                }))
                .optional(),
        })
        .transform(
            ({
                appid,
                credProps,
                hmacCreateSecret,
                prf,
                ...extensions
            }): AuthenticationExtensionsClientOutputs => ({
                ...extensions,
                ...(appid === undefined ? {} : { appid }),
                ...(credProps === undefined ? {} : { credProps }),
                ...(hmacCreateSecret === undefined ? {} : { hmacCreateSecret }),
                ...(prf === undefined ? {} : { prf }),
            }),
        ),
)

export const opaqueAuthChallengeSchema = z.string().regex(OPAQUE_TOKEN_PATTERN)

export const authenticationResponseSchema = z
    .object({
        authenticatorAttachment: authenticatorAttachmentSchema,
        clientExtensionResults: clientExtensionResultsSchema,
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
    .transform(
        ({ authenticatorAttachment, response, ...credential }): AuthenticationResponseJSON => ({
            ...credential,
            ...(authenticatorAttachment === undefined ? {} : { authenticatorAttachment }),
            response: {
                authenticatorData: response.authenticatorData,
                clientDataJSON: response.clientDataJSON,
                signature: response.signature,
                ...(response.userHandle == null ? {} : { userHandle: response.userHandle }),
            },
        }),
    )

export const registrationResponseSchema = z
    .object({
        authenticatorAttachment: authenticatorAttachmentSchema,
        clientExtensionResults: clientExtensionResultsSchema,
        id: credentialIdSchema,
        rawId: credentialIdSchema,
        response: z.object({
            attestationObject: attestationObjectSchema,
            clientDataJSON: clientDataSchema,
            transports: z.array(authenticatorTransportSchema).max(8).optional(),
        }),
        type: z.literal('public-key'),
    })
    .refine((credential) => credential.id === credential.rawId, {
        message: 'Credential identifiers do not match.',
        path: ['rawId'],
    })
    .transform(
        ({ authenticatorAttachment, response, ...credential }): RegistrationResponseJSON => ({
            ...credential,
            ...(authenticatorAttachment === undefined ? {} : { authenticatorAttachment }),
            response: {
                attestationObject: response.attestationObject,
                clientDataJSON: response.clientDataJSON,
                ...(response.transports === undefined ? {} : { transports: response.transports }),
            },
        }),
    )

import { describe, expect, spyOn, test } from 'bun:test'
import { z } from 'zod'
import { createOidcProviderId } from '@/lib/Auth/Oidc/providerId.ts'
import { providerDraft, providerInput } from '@/features/Admin/OidcProviders/validation.ts'

describe('OIDC provider and editor row identifiers', () => {
    test('uses the native UUID generator when available', () => {
        const expected = '11111111-1111-4111-8111-111111111111'
        const native = spyOn(crypto, 'randomUUID').mockReturnValue(expected)
        try {
            expect(createOidcProviderId()).toBe(expected)
            expect(native).toHaveBeenCalledTimes(1)
        } finally {
            native.mockRestore()
        }
    })

    test('retains UUIDv4 validity and provider identity without the secure-context helper', () => {
        const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
        Object.defineProperty(crypto, 'randomUUID', { value: undefined })
        try {
            const values = Array.from({ length: 64 }, createOidcProviderId)
            expect(new Set(values).size).toBe(64)
            for (const value of values) {
                expect(z.uuidv4().safeParse(value).success).toBeTrue()
            }
            const initial = providerDraft()
            const saved = {
                ...providerInput(initial),
                revision: 1,
                credentialConfigured: true,
                bindings: [{ subject: 'unchanged-subject', userId: initial.id }],
            }
            const reopened = providerDraft(saved)
            expect(reopened.id).toBe(initial.id)
            expect(reopened.bindings[0]?.subject).toBe('unchanged-subject')
            expect(z.uuidv4().safeParse(reopened.bindings[0]?.rowId).success).toBeTrue()
            expect(reopened.clientSecret).toBe('')
        } finally {
            if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor)
            else Reflect.deleteProperty(crypto, 'randomUUID')
        }
    })
})

import { expect, test } from 'bun:test'
import { newPasswordSchema } from '@/lib/Auth/validation.ts'
import getFieldErrorMessage from '@/lib/Forms/fieldErrors.ts'

test('password size errors localize without promising a Unicode character maximum', () => {
    const result = newPasswordSchema.safeParse('😀'.repeat(129))
    expect(result.success).toBeFalse()
    if (result.success) throw new Error('Expected the technical password size limit')
    expect(getFieldErrorMessage(result.error.issues)).toBe('Password is too long.')
    expect(getFieldErrorMessage(result.error.issues, (key) => key)).toBe(
        'validation.passwordTooLong',
    )
})

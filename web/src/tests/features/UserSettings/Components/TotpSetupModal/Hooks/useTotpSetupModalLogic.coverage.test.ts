import { expect, mock, test } from 'bun:test'
import type { FormEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
import useTotpSetupModalLogic from '@/features/UserSettings/Components/TotpSetupModal/Hooks/useTotpSetupModalLogic.ts'

test('TOTP wizard normalizes proofs, submits validated code and resets on close while guarding pending dismissal', async () => {
    const close = mock(() => {})
    const confirm = mock(async (_code: string) => ({ success: true }))
    let pending = false
    const hook = await mountHook(() =>
        useTotpSetupModalLogic({ isPending: pending, onClose: close, onConfirm: confirm }),
    )
    try {
        expect(hook.value.handler.normalizeCode('12a34-56789')).toBe('123456')
        expect(hook.value.handler.validateCode({ value: '12' })).toBeDefined()
        expect(hook.value.handler.validateCode({ value: '123456' })).toBeUndefined()
        await hook.run(() => hook.value.handler.verify())
        expect(hook.value.state.step).toBe('verify')
        await hook.run(() => hook.value.form.setFieldValue('code', '123456'))
        const event = {
            preventDefault: mock(() => {}),
            stopPropagation: mock(() => {}),
        } as unknown as FormEvent<HTMLFormElement>
        await hook.run(() => hook.value.handler.handleSubmit(event))
        expect(confirm).toHaveBeenCalledWith('123456')
        pending = true
        await hook.run(() => hook.value.handler.back())
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(close).not.toHaveBeenCalled()
        pending = false
        await hook.run(() => hook.value.handler.verify())
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(close).toHaveBeenCalledTimes(1)
        expect(hook.value.state.step).toBe('scan')
        expect(hook.value.form.getFieldValue('code')).toBe('')
        expect(event.preventDefault).toHaveBeenCalledTimes(1)
    } finally {
        await hook.dispose()
    }
})

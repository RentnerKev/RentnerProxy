import { expect, mock, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
import useRenamePasskeyModalLogic from '@/features/UserSettings/Components/RenamePasskeyModal/Hooks/useRenamePasskeyModalLogic.ts'

test('passkey naming clamps input, rejects empty confirmation and guards dismissal during registration', async () => {
    const confirm = mock((_name: string) => {})
    const close = mock(() => {})
    let pending = false
    const hook = await mountHook(() =>
        useRenamePasskeyModalLogic('Laptop', confirm, close, pending),
    )
    try {
        await hook.run(() => hook.value.handler.setName(' '))
        await hook.run(() => hook.value.handler.confirm())
        expect(confirm).not.toHaveBeenCalled()
        expect(hook.value.state.canSubmit).toBe(false)
        await hook.run(() => hook.value.handler.setName('x'.repeat(101)))
        expect(hook.value.state.name).toHaveLength(100)
        pending = true
        await hook.run(() => hook.value.handler.setName(' Work laptop '))
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(close).not.toHaveBeenCalled()
        await hook.run(() => hook.value.handler.confirm())
        expect(confirm).toHaveBeenCalledWith('Work laptop')
        pending = false
        await hook.run(() => hook.value.handler.setName('Phone'))
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(close).toHaveBeenCalledTimes(1)
    } finally {
        await hook.dispose()
    }
})

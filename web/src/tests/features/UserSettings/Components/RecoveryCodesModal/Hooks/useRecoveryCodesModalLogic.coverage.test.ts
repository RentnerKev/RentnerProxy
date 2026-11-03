import { expect, mock, spyOn, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
import useRecoveryCodesModalLogic from '@/features/UserSettings/Components/RecoveryCodesModal/Hooks/useRecoveryCodesModalLogic.ts'

test('recovery codes copy as separate lines and report clipboard rejection without closing the dialog', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const close = mock(() => {})
    const hook = await mountHook(() =>
        useRecoveryCodesModalLogic(['first-fixture', 'second-fixture'], close),
    )
    try {
        await hook.run(() => hook.value.handler.copy())
        expect(write).toHaveBeenCalledWith('first-fixture\nsecond-fixture')
        expect(hook.value.state.copied).toBe(true)
        write.mockRejectedValueOnce(new Error('clipboard unavailable'))
        await hook.run(() => hook.value.handler.copy())
        expect(hook.value.state.copied).toBe(false)
        expect(close).not.toHaveBeenCalled()
        await hook.run(() => hook.value.handler.handleOpenChange(true))
        expect(close).not.toHaveBeenCalled()
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(close).toHaveBeenCalledTimes(1)
    } finally {
        await hook.dispose()
        write.mockRestore()
    }
})

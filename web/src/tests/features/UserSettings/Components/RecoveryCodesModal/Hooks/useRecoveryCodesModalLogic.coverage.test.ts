import { expect, mock, spyOn, test } from 'bun:test'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from '@rentnerkev/toasts'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import withTestLanguage, { catalogs } from '@/tests/Helpers/withTestLanguage.tsx'
import useRecoveryCodesModalLogic from '@/features/UserSettings/Components/RecoveryCodesModal/Hooks/useRecoveryCodesModalLogic.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('recovery codes copy as separate lines and report localized clipboard feedback without exposing codes or closing the dialog', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const close = mock(() => {})
    const success = spyOn(toast, 'success').mockReturnValue('success-fixture')
    const error = spyOn(toast, 'error').mockReturnValue('error-fixture')
    let logic: ReturnType<typeof useRecoveryCodesModalLogic> | undefined
    function Probe() {
        const current = useRecoveryCodesModalLogic(['first-fixture', 'second-fixture'], close)
        useEffect(() => {
            logic = current
        }, [current])
        return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
        await act(async () => root.render(withTestLanguage(createElement(Probe))))
        await act(async () => logic!.handler.copy())
        expect(write).toHaveBeenCalledWith('first-fixture\nsecond-fixture')
        expect(success).toHaveBeenCalledTimes(1)
        expect(success).toHaveBeenCalledWith(catalogs.en.account.recoveryCodes.copied, {
            title: catalogs.en.toast.titles.success,
        })
        expect(error).not.toHaveBeenCalled()
        write.mockRejectedValueOnce(new Error('clipboard unavailable'))
        await act(async () => logic!.handler.copy())
        expect(error).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledWith(catalogs.en.admin.certificates.manualDns.copyFailed, {
            title: catalogs.en.toast.titles.error,
        })
        expect(success).toHaveBeenCalledTimes(1)
        expect(JSON.stringify([success.mock.calls, error.mock.calls])).not.toContain(
            'first-fixture',
        )
        expect(JSON.stringify([success.mock.calls, error.mock.calls])).not.toContain(
            'second-fixture',
        )
        expect(JSON.stringify(error.mock.calls)).not.toContain('clipboard unavailable')
        expect(close).not.toHaveBeenCalled()
        await act(async () => logic!.handler.handleOpenChange(true))
        expect(close).not.toHaveBeenCalled()
        await act(async () => logic!.handler.handleOpenChange(false))
        expect(close).toHaveBeenCalledTimes(1)
    } finally {
        await act(async () => root.unmount())
        container.remove()
        write.mockRestore()
        success.mockRestore()
        error.mockRestore()
    }
})

test('copy feedback leaves the recovery codes selectable and the copy button label unchanged', async () => {
    const { default: RecoveryCodesModal } =
        await import('@/features/UserSettings/Components/RecoveryCodesModal/index.tsx')
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const success = spyOn(toast, 'success').mockReturnValue('success-fixture')
    const error = spyOn(toast, 'error').mockReturnValue('error-fixture')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
        await act(async () =>
            root.render(
                withTestLanguage(
                    createElement(RecoveryCodesModal, {
                        codes: ['first-fixture', 'second-fixture'],
                        onClose: () => {},
                    }),
                ),
            ),
        )
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        const copy = [...dialog.querySelectorAll('button')].find(
            (button) => button.textContent === catalogs.en.account.recoveryCodes.copyAll,
        )!
        await act(async () => copy.click())
        expect(success).toHaveBeenCalledTimes(1)
        expect(copy.textContent).toBe(catalogs.en.account.recoveryCodes.copyAll)
        expect(dialog.textContent).not.toContain(catalogs.en.account.recoveryCodes.copied)
        write.mockRejectedValueOnce(new Error('denied'))
        await act(async () => copy.click())
        expect(error).toHaveBeenCalledTimes(1)
        expect(dialog.textContent).not.toContain(
            catalogs.en.admin.certificates.manualDns.copyFailed,
        )
        expect([...dialog.querySelectorAll('code')].map((entry) => entry.textContent)).toEqual([
            'first-fixture',
            'second-fixture',
        ])
        expect(copy.disabled).toBe(false)
    } finally {
        await act(async () => root.unmount())
        container.remove()
        write.mockRestore()
        success.mockRestore()
        error.mockRestore()
    }
})

for (const transition of ['close', 'codes', 'null', 'unmount'] as const) {
    for (const outcome of ['resolve', 'reject'] as const) {
        test(`ignores clipboard ${outcome} after recovery-code ${transition}`, async () => {
            let resolve!: () => void
            let reject!: (error: Error) => void
            const write = spyOn(navigator.clipboard, 'writeText').mockReturnValue(
                new Promise<void>((done, fail) => {
                    resolve = done
                    reject = fail
                }),
            )
            const success = spyOn(toast, 'success').mockReturnValue('success-fixture')
            const error = spyOn(toast, 'error').mockReturnValue('error-fixture')
            let logic: ReturnType<typeof useRecoveryCodesModalLogic> | undefined
            function Probe({ codes }: { codes: readonly string[] | null }) {
                const current = useRecoveryCodesModalLogic(codes, () => {})
                useEffect(() => {
                    logic = current
                }, [current])
                return null
            }
            const container = document.createElement('div')
            document.body.append(container)
            const root = createRoot(container)
            let unmounted = false
            let pending: Promise<void> | undefined
            try {
                await act(async () =>
                    root.render(withTestLanguage(createElement(Probe, { codes: ['old-fixture'] }))),
                )
                await act(async () => {
                    pending = logic!.handler.copy()
                })
                expect(write).toHaveBeenCalledTimes(1)
                if (transition === 'close') {
                    await act(async () => logic!.handler.handleOpenChange(false))
                    await act(async () => logic!.handler.copy())
                    expect(write).toHaveBeenCalledTimes(1)
                } else if (transition === 'unmount') {
                    await act(async () => root.unmount())
                    unmounted = true
                } else {
                    await act(async () =>
                        root.render(
                            withTestLanguage(
                                createElement(Probe, {
                                    codes: transition === 'null' ? null : ['new-fixture'],
                                }),
                            ),
                        ),
                    )
                    if (transition === 'null') {
                        await act(async () => logic!.handler.copy())
                        expect(write).toHaveBeenCalledTimes(1)
                    }
                }
                await act(async () => {
                    if (outcome === 'resolve') resolve()
                    else reject(new Error('private clipboard failure'))
                    await pending
                })
                expect(success).not.toHaveBeenCalled()
                expect(error).not.toHaveBeenCalled()
            } finally {
                if (!unmounted) await act(async () => root.unmount())
                container.remove()
                write.mockRestore()
                success.mockRestore()
                error.mockRestore()
            }
        })
    }
}

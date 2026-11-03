import { expect, mock, spyOn, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
const { default: useNavigationExpansion } =
    await import('@/layouts/AuthenticatedLayout/Components/ApplicationShell/Hooks/useNavigationExpansion.ts')

test('navigation toggles derive accessible labels and return focus only to a connected visible opener', async () => {
    const hook = await mountHook(useNavigationExpansion)
    const mobile = document.createElement('button')
    const desktop = document.createElement('button')
    document.body.append(mobile, desktop)
    const mobileRects = spyOn(mobile, 'getClientRects').mockReturnValue(
        [] as unknown as DOMRectList,
    )
    const desktopRects = spyOn(desktop, 'getClientRects').mockReturnValue([
        new DOMRect(0, 0, 10, 10),
    ] as unknown as DOMRectList)
    try {
        hook.value.refs.mobileNavigationToggle.current = mobile
        hook.value.refs.desktopNavigationToggle.current = desktop
        await hook.run(() => hook.value.handler.toggleNavigation())
        expect(hook.value.state.isNavigationExpanded).toBe(false)
        expect(hook.value.state.navigationToggleLabel).toBe('shell.expandNavigation')
        await hook.run(() => hook.value.handler.toggleMobileNavigation())
        expect(hook.value.state.isMobileNavigationOpen).toBe(true)
        await hook.run(() => hook.value.handler.handleMobileNavigationOpenChange(false))
        expect(hook.value.state.isMobileNavigationOpen).toBe(false)
        await hook.run(() => hook.value.handler.closeMobileNavigation())
        const event = new Event('closeAutoFocus', { cancelable: true })
        await hook.run(() => hook.value.handler.restoreMobileNavigationFocus(event))
        expect(document.activeElement).toBe(desktop)
        expect(event.defaultPrevented).toBe(true)
        desktop.remove()
        mobile.remove()
        const disconnected = new Event('closeAutoFocus', { cancelable: true })
        await hook.run(() => hook.value.handler.restoreMobileNavigationFocus(disconnected))
        expect(disconnected.defaultPrevented).toBe(false)
    } finally {
        await hook.dispose()
        mobileRects.mockRestore()
        desktopRects.mockRestore()
        mobile.remove()
        desktop.remove()
    }
})

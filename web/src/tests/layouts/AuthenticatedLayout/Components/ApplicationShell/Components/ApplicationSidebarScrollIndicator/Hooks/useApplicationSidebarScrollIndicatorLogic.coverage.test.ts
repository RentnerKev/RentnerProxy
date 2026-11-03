import { expect, mock, spyOn, test } from 'bun:test'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
import useApplicationSidebarScrollIndicatorLogic from '@/layouts/AuthenticatedLayout/Components/ApplicationShell/Components/ApplicationSidebarScrollIndicator/Hooks/useApplicationSidebarScrollIndicatorLogic.ts'

test('sidebar scroll thumb supports bounded geometry, drag capture and keyboard navigation with teardown', async () => {
    const sidebar = document.createElement('aside')
    const scroll = document.createElement('div')
    sidebar.append(scroll)
    document.body.append(sidebar)
    Object.defineProperties(scroll, { scrollHeight: { value: 400 }, clientHeight: { value: 100 } })
    const sidebarBounds = spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 300, 200),
    )
    const scrollBounds = spyOn(scroll, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 250, 100),
    )
    const target = document.createElement('div')
    Object.assign(target, {
        setPointerCapture: mock(() => {}),
        hasPointerCapture: mock(() => true),
        releasePointerCapture: mock(() => {}),
    })
    const scrollRef = { current: scroll }
    const sidebarRef = { current: sidebar }
    const hook = await mountHook(() =>
        useApplicationSidebarScrollIndicatorLogic(scrollRef, sidebarRef),
    )
    try {
        expect(hook.value.state.position?.maxScroll).toBe(300)
        const down = {
            button: 0,
            clientY: 20,
            pointerId: 1,
            currentTarget: target,
            preventDefault: mock(() => {}),
        } as unknown as ReactPointerEvent<HTMLDivElement>
        await hook.run(() => hook.value.handler.handlePointerDown(down))
        expect(hook.value.state.isDragging).toBe(true)
        expect(target.setPointerCapture).toHaveBeenCalledWith(1)
        await hook.run(() => hook.value.handler.handlePointerMove({ ...down, clientY: 50 }))
        expect(scroll.scrollTop).toBeGreaterThan(100)
        await hook.run(() => hook.value.handler.handlePointerEnd(down))
        expect(hook.value.state.isDragging).toBe(false)
        expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
        async function checkKey(key: string, initial: number, expected: number) {
            scroll.scrollTop = initial
            const event = {
                key,
                preventDefault: mock(() => {}),
            } as unknown as ReactKeyboardEvent<HTMLDivElement>
            await hook.run(() => hook.value.handler.handleKeyDown(event))
            expect(scroll.scrollTop).toBe(expected)
            expect(event.preventDefault).toHaveBeenCalledTimes(1)
        }
        await checkKey('ArrowDown', 0, 48)
        await checkKey('ArrowUp', 80, 32)
        await checkKey('PageDown', 0, 80)
        await checkKey('PageUp', 100, 20)
        await checkKey('Home', 50, 0)
        await checkKey('End', 0, 400)
        const ignored = {
            key: 'Escape',
            preventDefault: mock(() => {}),
        } as unknown as ReactKeyboardEvent<HTMLDivElement>
        await hook.run(() => hook.value.handler.handleKeyDown(ignored))
        expect(ignored.preventDefault).not.toHaveBeenCalled()
        scrollBounds.mockReturnValue(new DOMRect(0, 0, 250, 0))
        await hook.run(() => window.dispatchEvent(new Event('resize')))
        expect(hook.value.state.position).toBeNull()
    } finally {
        await hook.dispose()
        sidebarBounds.mockRestore()
        scrollBounds.mockRestore()
        sidebar.remove()
    }
})

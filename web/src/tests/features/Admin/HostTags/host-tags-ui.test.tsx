import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import type { HostKind, HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import { emptyHostTagState, HostTagDomainError, mutateHostTags } from '@/lib/HostTags/hostTags.ts'
import { hostTagMutationSchema } from '@/features/Admin/HostTags/validation.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ToastProvider } = await import('@rentnerkev/toasts')
const infra = { id: '00000000-0000-4000-8000-000000000001', name: 'Infrastruktur' }
const privateTag = { id: '00000000-0000-4000-8000-000000000002', name: 'Privat' }
const hostId = '00000000-0000-4000-8000-000000000003'
let states: Record<HostKind, HostTagState>
const getCatalog = mock(async ({ data }: { data: HostKind }) => ({
    revision: states[data].revision,
    tags: states[data].tags,
}))
const mutate = mock(async ({ data }: { data: unknown }) => {
    const mutation = hostTagMutationSchema.parse(data)
    try {
        states[mutation.kind] = mutateHostTags(states[mutation.kind], mutation, crypto.randomUUID())
        return {
            success: true as const,
            value: { revision: states[mutation.kind].revision, tags: states[mutation.kind].tags },
        }
    } catch (error) {
        if (!(error instanceof HostTagDomainError)) throw error
        return { success: false as const, message: error.message }
    }
})
mock.module('@/features/Admin/HostTags/middleware.ts', () => ({
    getHostTagCatalogHandler: getCatalog,
    mutateHostTagHandler: mutate,
}))
const { default: HostTagManager } =
    await import('@/features/Admin/HostTags/Components/HostTagManager.tsx')
const { default: HostTagsCell } =
    await import('@/features/Admin/HostTags/Components/HostTagsCell.tsx')
let root: Root | undefined
let client: InstanceType<typeof QueryClient>

async function render(element: ReactElement) {
    const container = document.createElement('div')
    document.body.append(container)
    client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <ToastProvider {...TOAST_PROVIDER_PROPS}>{element}</ToastProvider>
                </QueryClientProvider>,
                'de',
            ),
        ),
    )
}
async function waitFor(condition: () => boolean) {
    for (let index = 0; index < 60 && !condition(); index++) {
        // oxlint-disable-next-line no-await-in-loop -- UI polling must flush each React update before checking again.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}
function button(text: string): HTMLButtonElement {
    const target = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (element) =>
            element.textContent?.trim() === text || element.getAttribute('aria-label') === text,
    )
    expect(target).toBeDefined()
    return target!
}
async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
async function input(value: string) {
    const element = document.querySelector<HTMLInputElement>('input[id$="-name"]')!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
beforeEach(() => {
    states = {
        proxy: {
            version: 1,
            revision: 1,
            tags: [infra, privateTag],
            assignments: { [hostId]: [infra.id] },
        },
        redirect: emptyHostTagState(),
    }
    mutate.mockClear()
    getCatalog.mockClear()
})
afterEach(async () => {
    await act(async () => root?.unmount())
    client?.clear()
    document.body.innerHTML = ''
    root = undefined
})

describe('localized accessible host tags', () => {
    test('creates and renames a tag, validates duplicates, and confirms deletion without removing hosts', async () => {
        await render(<HostTagManager kind="proxy" />)
        await click(button('Tags verwalten'))
        await waitFor(() => document.querySelector('input[id$="-name"]') !== null)
        expect(document.querySelector('label')?.textContent).toContain('Tag-Name')
        expect(document.body.textContent).toContain('Beim Duplizieren werden Tags übernommen')
        await input('  büro  ')
        await click(button('Tag erstellen'))
        await waitFor(() => states.proxy.tags.length === 3)
        expect(states.proxy.tags[2]?.name).toBe('büro')
        await input('INFRASTRUKTUR')
        await click(button('Tag erstellen'))
        await waitFor(() => document.body.textContent?.includes('existiert bereits') === true)
        expect(states.proxy.tags).toHaveLength(3)
        await click(button('Infrastruktur umbenennen'))
        await input('Serverfarm')
        await click(button('Änderungen speichern'))
        await waitFor(() => states.proxy.tags[0]?.name === 'Serverfarm')
        expect(states.proxy.assignments[hostId]).toEqual([infra.id])
        await waitFor(() => button('Tag Serverfarm löschen').disabled === false)
        await click(button('Tag Serverfarm löschen'))
        await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 2)
        const confirmation = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
        expect(confirmation.textContent).toContain(
            'Hosts und ihre Routing-Konfiguration bleiben erhalten',
        )
        await click(
            [...confirmation.querySelectorAll('button')].find(
                (element) => element.textContent?.trim() === 'Löschen',
            )!,
        )
        await waitFor(() => states.proxy.tags.length === 2)
        expect(states.proxy.assignments[hostId]).toBeUndefined()
        expect(states.redirect).toEqual(emptyHostTagState())
    })
    test('allows keyboard multi-selection on a discovered host and submits an independent metadata assignment', async () => {
        await render(
            <HostTagsCell
                kind="proxy"
                hostId={hostId}
                hostLabel="docker.example.com"
                tags={[infra]}
                canManage
            />,
        )
        await click(button('Tags für docker.example.com bearbeiten'))
        await waitFor(
            () =>
                document.querySelector<HTMLButtonElement>('button[role="combobox"]')?.disabled ===
                false,
        )
        await click(document.querySelector('button[role="combobox"]')!)
        await waitFor(() => document.querySelectorAll('[role="option"]').length === 2)
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (element) => element.textContent?.includes('Privat'),
        )!
        await act(async () => {
            option.focus()
            option.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
            )
        })
        await act(async () => {
            document.activeElement?.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            )
        })
        await click(button('Änderungen speichern'))
        await waitFor(() => states.proxy.assignments[hostId]?.length === 2)
        expect(mutate.mock.calls[0]?.[0].data).toEqual({
            kind: 'proxy',
            action: 'assign',
            hostId,
            tagIds: [infra.id, privateTag.id],
            expectedTagIds: [infra.id],
            expectedRevision: 1,
        })
    })
    test('shows tags to viewers without edit controls or catalog requests', async () => {
        await render(
            <HostTagsCell
                kind="redirect"
                hostId={hostId}
                hostLabel="redirect.example.com"
                tags={[infra]}
                canManage={false}
            />,
        )
        expect(document.body.textContent).toContain('Infrastruktur')
        expect(
            document.querySelector('button[aria-label="Tags für redirect.example.com bearbeiten"]'),
        ).toBeNull()
        expect(getCatalog).not.toHaveBeenCalled()
        expect(mutate).not.toHaveBeenCalled()
    })
    test('rejects a concurrent edit and closes the stale assignment rather than overwriting it', async () => {
        await render(
            <HostTagsCell
                kind="proxy"
                hostId={hostId}
                hostLabel="app.example.com"
                tags={[infra]}
                canManage
            />,
        )
        await click(button('Tags für app.example.com bearbeiten'))
        await waitFor(() => button('Änderungen speichern').disabled === false)
        states.proxy = { ...states.proxy, revision: 2, assignments: { [hostId]: [privateTag.id] } }
        await click(button('Änderungen speichern'))
        await waitFor(
            () => document.body.textContent?.includes('während der Bearbeitung geändert') === true,
        )
        expect(states.proxy.assignments[hostId]).toEqual([privateTag.id])
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
})

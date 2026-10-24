import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'
import { DEFAULT_HOST_TAG_COLOR } from '@/config/host-tags.config.ts'
import type {
    HostKind,
    HostTagCatalog,
    HostTagState,
} from '@/lib/HostTags/Types/host-tags.types.ts'
import { emptyHostTagState, HostTagDomainError, mutateHostTags } from '@/lib/HostTags/hostTags.ts'
import { hostTagMutationSchema } from '@/features/Admin/HostTags/validation.ts'
import withTestLanguage, { bootstraps, catalogs } from '@/tests/Helpers/withTestLanguage.tsx'
import { AuthenticatedLanguageProvider } from '@/shared/Language/Hooks/useTranslationStore.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()
const { act, useEffect, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const infra = { id: '00000000-0000-4000-8000-000000000001', name: 'Infrastruktur' }
const privateTag = { id: '00000000-0000-4000-8000-000000000002', name: 'Privat' }
const hostId = '00000000-0000-4000-8000-000000000003'
let states: Record<HostKind, HostTagState>
const getCatalog = mock(async ({ data }: { data: HostKind }): Promise<HostTagCatalog> => ({
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
const { default: useHostListInput } =
    await import('@/features/Admin/HostTags/Hooks/useHostListInput.ts')
const { default: ProxyHostsTable } =
    await import('@/features/Admin/ProxyHostManagement/Components/ProxyHostsTable/index.tsx')
const { default: RedirectHostsTable } =
    await import('@/features/Admin/RedirectHostManagement/Components/RedirectHostsTable/index.tsx')
let root: Root | undefined
let client: InstanceType<typeof QueryClient>
let listInput: ReturnType<typeof useHostListInput>
let refreshHostTable: (() => void) | undefined

function HostListInputProbe() {
    const logic = useHostListInput()
    useEffect(() => {
        listInput = logic
    }, [logic])
    return <output>{logic.query.search}</output>
}

function HostTableRefreshProbe({
    kind,
    remote = false,
    translatedProtocol = false,
}: {
    readonly kind: HostKind
    readonly remote?: boolean
    readonly translatedProtocol?: boolean
}) {
    const [version, setVersion] = useState(0)
    const [bootstrap, setBootstrap] = useState(() => {
        const next = structuredClone(bootstraps.de)
        if (translatedProtocol)
            next.resources.de!.translation = {
                ...catalogs.de,
                admin: {
                    ...catalogs.de.admin,
                    proxyHosts: {
                        ...catalogs.de.admin.proxyHosts,
                        scheme: {
                            ...catalogs.de.admin.proxyHosts.scheme,
                            http: 'Klartextprotokoll',
                        },
                    },
                },
            }
        return next
    })
    useEffect(() => {
        refreshHostTable = () => {
            setVersion((current) => current + 1)
            setBootstrap(structuredClone(bootstraps.de))
        }
        return () => {
            refreshHostTable = undefined
        }
    }, [])
    const onAction = () => setVersion(version)
    const common = {
        ...(remote
            ? {
                  remote: {
                      rowCount: 1,
                      domains: ['app.example.com'],
                      tags: [infra],
                      initialState: {
                          globalFilter: '',
                          columnFilters: [],
                          sorting: [],
                          pagination: { pageIndex: 0, pageSize: 10 },
                      },
                      onStateChange: () => undefined,
                  },
              }
            : {}),
        loading: false,
        canUpdate: true,
        canDelete: false,
        canEnable: false,
        canDisable: false,
        isPending: false,
        onEdit: onAction,
        onDelete: onAction,
        onEnable: onAction,
        onDisable: onAction,
    }
    const host = {
        id: hostId,
        domains: ['app.example.com'],
        tags: [infra],
        enabled: true,
        certificateId: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-01T00:00:00Z'),
    }
    const table =
        kind === 'proxy' ? (
            <ProxyHostsTable
                {...common}
                proxyHosts={[
                    {
                        ...host,
                        forwardScheme: 'http',
                        forwardHost: 'upstream.internal',
                        forwardPort: 80,
                        forceHttps: false,
                        verifyUpstreamTls: true,
                        upstreamTlsServerName: null,
                        trustedCaId: null,
                    },
                ]}
            />
        ) : (
            <RedirectHostsTable
                {...common}
                redirectHosts={[
                    {
                        ...host,
                        destination: 'https://example.com',
                        statusCode: 302,
                        preserveRequestUri: true,
                    },
                ]}
            />
        )
    return (
        <AuthenticatedLanguageProvider bootstrap={bootstrap}>{table}</AuthenticatedLanguageProvider>
    )
}

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
                    <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
                        <ToastProvider {...TOAST_PROVIDER_PROPS}>{element}</ToastProvider>
                    </TooltipProvider>
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
function mousePointer(type: string, pageY: number) {
    const event = new PointerEvent(type, {
        bubbles: true,
        button: 0,
        cancelable: true,
        pointerType: 'mouse',
        clientY: pageY,
    })
    // Happy DOM does not derive page coordinates from client coordinates.
    Object.defineProperty(event, 'pageY', { value: pageY })
    return event
}
async function input(
    value: string,
    element = document.querySelector<HTMLInputElement>('input[id$="-name"]')!,
) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
    })
}
function colorInput() {
    return document
        .querySelector('button[id$="-color"]')!
        .parentElement!.querySelector<HTMLInputElement>('input')!
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
    test.each(['proxy', 'redirect'] as const)(
        'keeps %s tag selection and its draft open during pointer selection and authenticated route refreshes',
        async (kind) => {
            states[kind] = structuredClone(states.proxy)
            await render(<HostTableRefreshProbe kind={kind} />)
            await click(button('Tags für app.example.com bearbeiten'))
            const assignmentDialog = document.querySelector('[role="dialog"]')!
            await waitFor(
                () =>
                    assignmentDialog.querySelector<HTMLButtonElement>('button[role="combobox"]')
                        ?.disabled === false,
            )
            const trigger =
                assignmentDialog.querySelector<HTMLButtonElement>('button[role="combobox"]')!
            await act(async () => {
                trigger.dispatchEvent(mousePointer('pointerdown', 100))
            })
            await waitFor(() => document.querySelectorAll('[role="option"]').length === 2)
            const searchInput = document.querySelector<HTMLInputElement>(
                'input[placeholder="Tags suchen"]',
            )!
            await input('Privat', searchInput)
            await waitFor(() => document.querySelectorAll('[role="option"]').length === 1)
            const option = document.querySelector<HTMLElement>('[role="option"]')!
            const badge = option.querySelector('span[style]')!
            await act(async () => {
                option.focus()
                badge.dispatchEvent(mousePointer('pointermove', 180))
                badge.dispatchEvent(mousePointer('pointerdown', 180))
                badge.dispatchEvent(mousePointer('pointerup', 180))
                badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
            })
            expect(option.getAttribute('aria-selected')).toBe('true')
            expect(trigger.getAttribute('aria-expanded')).toBe('true')
            expect(trigger.textContent).toContain('Privat')
            await act(async () => {
                refreshHostTable?.()
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            expect(assignmentDialog.isConnected).toBe(true)
            expect(searchInput.isConnected).toBe(true)
            expect(searchInput.value).toBe('Privat')
            expect(trigger.getAttribute('aria-expanded')).toBe('true')
            expect(trigger.textContent).toContain('Privat')
        },
    )
    test('bounds pasted search text and keeps the last valid query when table state is invalid', async () => {
        await render(<HostListInputProbe />)
        await act(async () => {
            listInput.onStateChange({
                ...listInput.initialState,
                globalFilter: 'x'.repeat(300),
            })
        })
        expect(listInput.query.search).toBe('x'.repeat(256))
        const lastQuery = listInput.query
        await act(async () => {
            listInput.onStateChange({
                ...listInput.initialState,
                columnFilters: [{ id: 'destination', value: 'x'.repeat(4097) }],
            })
            listInput.onStateChange({
                ...listInput.initialState,
                pagination: { pageIndex: 0, pageSize: 101 },
            })
        })
        expect(listInput.query).toEqual(lastQuery)
        await act(async () => {
            listInput.onStateChange({ ...listInput.initialState, globalFilter: 'infra' })
        })
        expect(listInput.query.search).toBe('infra')
    })
    test('manages tags through an icon tooltip, saves colors, validates edits, and confirms deletion without removing hosts', async () => {
        await render(<HostTagManager kind="proxy" />)
        expect(button('Tags verwalten').textContent?.trim()).toBe('')
        await act(async () => button('Tags verwalten').focus())
        await waitFor(
            () => document.querySelector('[role="tooltip"]')?.textContent === 'Tags verwalten',
        )
        await click(button('Tags verwalten'))
        await waitFor(() => document.querySelector('input[id$="-name"]') !== null)
        expect(document.querySelector('label')?.textContent).toContain('Tag-Name')
        expect(document.body.textContent).not.toContain('Beim Duplizieren werden Tags übernommen')
        const managerDialog = document.querySelector('[role="dialog"]')!
        await click(document.querySelector('button[id$="-color"]')!)
        await waitFor(() => document.querySelector('[role="dialog"][aria-modal="false"]') !== null)
        const pickerDialog = document.querySelector('[role="dialog"][aria-modal="false"]')!
        expect(managerDialog.contains(pickerDialog)).toBe(true)
        expect(pickerDialog.contains(document.activeElement)).toBe(true)
        await act(async () => {
            document.activeElement?.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })
        expect(colorInput().value).toMatch(/^#[\da-f]{6}$/u)
        await click(button('Farbauswahl schließen'))
        expect(document.querySelector('[role="dialog"][aria-modal="false"]')).toBeNull()
        expect(managerDialog.isConnected).toBe(true)
        await input('  büro  ')
        await input('#003366', colorInput())
        await click(button('Tag erstellen'))
        await waitFor(() => states.proxy.tags.length === 3)
        expect(states.proxy.tags[2]?.name).toBe('büro')
        expect(states.proxy.tags[2]?.color).toBe('#003366')
        await input('INFRASTRUKTUR')
        await click(button('Tag erstellen'))
        await waitFor(() => document.body.textContent?.includes('existiert bereits') === true)
        expect(states.proxy.tags).toHaveLength(3)
        await click(button('Infrastruktur bearbeiten'))
        await input('Serverfarm')
        await input('invalid', colorInput())
        await waitFor(() => button('Änderungen speichern').disabled)
        await input('#ffcc00', colorInput())
        await waitFor(() => !button('Änderungen speichern').disabled)
        await click(button('Änderungen speichern'))
        await waitFor(() => states.proxy.tags[0]?.name === 'Serverfarm')
        expect(states.proxy.assignments[hostId]).toEqual([infra.id])
        expect(states.proxy.tags[0]?.color).toBe('#ffcc00')
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
    test('starts a new tag from an edit draft without renaming the existing tag or changing assignments', async () => {
        states.proxy.tags[0] = { ...infra, color: '#003366' }
        await render(<HostTagManager kind="proxy" />)
        await click(button('Tags verwalten'))
        await waitFor(() => document.querySelector('input[id$="-name"]') !== null)
        await click(button('Infrastruktur bearbeiten'))
        await input('Nicht gespeicherter Entwurf')
        await input('#ffcc00', colorInput())

        await click(button('Neuer Tag'))
        expect(document.querySelector<HTMLInputElement>('input[id$="-name"]')?.value).toBe('')
        expect(colorInput().value).toBe(DEFAULT_HOST_TAG_COLOR)
        expect(mutate).not.toHaveBeenCalled()

        await input('Neu angelegt')
        await click(button('Tag erstellen'))
        await waitFor(() => states.proxy.tags.length === 3)
        expect(mutate).toHaveBeenLastCalledWith({
            data: {
                kind: 'proxy',
                action: 'create',
                name: 'Neu angelegt',
                color: DEFAULT_HOST_TAG_COLOR,
                expectedRevision: 1,
            },
        })
        expect(states.proxy.tags[0]).toEqual({ ...infra, color: '#003366' })
        expect(states.proxy.assignments[hostId]).toEqual([infra.id])
    })
    test('renders colored option and selection badges, keeps label search and keyboard multi-selection, and assigns discovered hosts', async () => {
        states.proxy.tags = [
            { ...infra, color: '#003366' },
            { ...privateTag, color: '#ffcc00' },
        ]
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
        const selectTrigger = document.querySelector('button[role="combobox"]')!
        expect(
            selectTrigger.querySelector<HTMLSpanElement>('span[style]')?.style.backgroundColor,
        ).toBe('#003366')
        await click(selectTrigger)
        await waitFor(() => document.querySelectorAll('[role="option"]').length === 2)
        const infraOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (element) => element.textContent?.includes('Infrastruktur'),
        )!
        expect(
            infraOption.querySelector<HTMLSpanElement>('span[style]')?.style.backgroundColor,
        ).toBe('#003366')
        await input(
            'Privat',
            document.querySelector<HTMLInputElement>('input[placeholder="Tags suchen"]')!,
        )
        await waitFor(() => document.querySelectorAll('[role="option"]').length === 1)
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (element) => element.textContent?.includes('Privat'),
        )!
        expect(option.querySelector<HTMLSpanElement>('span[style]')?.style.backgroundColor).toBe(
            '#ffcc00',
        )
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
        expect(
            [...selectTrigger.querySelectorAll<HTMLSpanElement>('span[style]')].map(
                (badge) => badge.style.backgroundColor,
            ),
        ).toEqual(['#003366', '#ffcc00'])
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
                tags={[{ ...infra, color: '#003366' }]}
                canManage={false}
            />,
        )
        expect(document.body.textContent).toContain('Infrastruktur')
        const tag = document.querySelector<HTMLSpanElement>('span[title="Infrastruktur"]')!
        expect(
            tag.querySelector<HTMLSpanElement>('span[aria-hidden="true"]')?.style.backgroundColor,
        ).toBe('#003366')
        expect(
            document.querySelector('button[aria-label="Tags für redirect.example.com bearbeiten"]'),
        ).toBeNull()
        expect(getCatalog).not.toHaveBeenCalled()
        expect(mutate).not.toHaveBeenCalled()
    })
    test('keeps Save disabled while a cached catalog refetches and submits its latest revision', async () => {
        await render(
            <HostTagsCell
                kind="proxy"
                hostId={hostId}
                hostLabel="app.example.com"
                tags={[infra]}
                canManage
            />,
        )
        client.setQueryData(['admin', 'proxy-hosts', 'tags'], {
            revision: 0,
            tags: [infra],
        })
        const { promise: pendingCatalog, resolve: resolveCatalog } =
            Promise.withResolvers<HostTagCatalog>()
        getCatalog.mockImplementationOnce(async () => pendingCatalog)
        await click(button('Tags für app.example.com bearbeiten'))
        await waitFor(() => getCatalog.mock.calls.length > 0)
        expect(button('Änderungen speichern').disabled).toBe(true)
        expect(mutate).not.toHaveBeenCalled()
        await act(async () => {
            resolveCatalog({ revision: states.proxy.revision, tags: states.proxy.tags })
        })
        await waitFor(() => button('Änderungen speichern').disabled === false)
        await click(button('Änderungen speichern'))
        await waitFor(() => mutate.mock.calls.length === 1)
        expect(mutate.mock.calls[0]?.[0].data).toMatchObject({ expectedRevision: 1 })
        expect(document.querySelector('[role="dialog"]')).toBeNull()
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

test.each(['proxy', 'redirect'] as const)(
    'keeps %s standalone search and localized status matching',
    async (kind) => {
        await render(<HostTableRefreshProbe kind={kind} />)
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
        await input('  APP.EXAMPLE.COM  ', search)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })
        expect(visibleHostRow()).toBeTrue()
        await input('does-not-match', search)
        await waitFor(() => !visibleHostRow())
        await input('AKTIVIERT', search)
        await waitFor(visibleHostRow)
        // Client global search historically excludes tag names; server search includes them.
        await input('INFRASTRUKTUR', search)
        await waitFor(() => !visibleHostRow())
    },
)

test.each(['proxy', 'redirect'] as const)(
    'does not filter the delivered %s remote page again',
    async (kind) => {
        await render(<HostTableRefreshProbe kind={kind} remote />)
        await input(
            'does-not-match',
            document.querySelector<HTMLInputElement>('input[type="search"]')!,
        )
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })
        expect(document.querySelector('tbody')?.textContent).toContain('app.example.com')
    },
)

test('keeps the translated protocol as an extra proxy-client search term', async () => {
    await render(<HostTableRefreshProbe kind="proxy" translatedProtocol />)
    await input(
        'KLARTEXTPROTOKOLL',
        document.querySelector<HTMLInputElement>('input[type="search"]')!,
    )
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350))
    })
    expect(document.querySelector('tbody')?.textContent).toContain('app.example.com')
})

function visibleHostRow() {
    return [...document.querySelectorAll('tbody a')].some(
        (link) => link.textContent?.trim() === 'app.example.com',
    )
}

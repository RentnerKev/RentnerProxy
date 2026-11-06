import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Root } from 'react-dom/client'
import type { DefaultSiteEditorData } from '@/lib/DefaultSite/Types/default-site.types.ts'
import type {
    DefaultSiteFormatResult,
    DefaultSiteSaveResult,
} from '@/features/DefaultSite/Types/middleware.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { getDefaultSitePageViewModel } from '@/lib/DefaultSite/defaultSitePage.ts'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { setClientCspNonce } from '@/lib/Security/cspNonce.ts'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, Activity } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: withTestPageAlerts } = await import('@/tests/Helpers/withTestPageAlerts.tsx')
const { default: withTestLanguage, catalogs } = await import('@/tests/Helpers/withTestLanguage.tsx')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')
const { InputProvider } = await import('@rentnerkev/inputs')
const { INPUT_PROVIDER_PROPS } = await import('@/config/input.config.ts')
const { TOAST_PROVIDER_PROPS } = await import('@/config/toast.config.ts')
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import('@tanstack/react-router')
const { renderToString } = await import('react-dom/server')
const { EditorView } = await import('@codemirror/view')
const { default: ApplicationNavigation } =
    await import('@/layouts/AuthenticatedLayout/Components/ApplicationShell/Components/ApplicationNavigation/index.tsx')

let saved: DefaultSiteEditorData = { baseRevision: 'revision-1', settings: { mode: 'not-found' } }
let outcome: DefaultSiteSaveResult = {
    success: true,
    message: 'defaultSite.saved',
    runtimeStatus: 'applied',
}
const getSettings = mock(async (): Promise<DefaultSiteEditorData> => saved)
const saveSettings = mock(
    async ({ data }: { data: DefaultSiteEditorData }): Promise<DefaultSiteSaveResult> => {
        if (outcome.success) saved = { baseRevision: 'revision-2', settings: data.settings }
        return outcome
    },
)
let formatOutcome: DefaultSiteFormatResult = { success: true, html: '<p>formatted</p>\n' }
const formatSettings = mock(
    async (_input: { data: string }): Promise<DefaultSiteFormatResult> => formatOutcome,
)
mock.module('@/features/DefaultSite/middleware.ts', () => ({
    getDefaultSiteHandler: getSettings,
    saveDefaultSiteHandler: saveSettings,
    formatDefaultSiteHtmlHandler: formatSettings,
}))
const { default: DefaultSitePanel } =
    await import('@/features/DefaultSite/Components/DefaultSitePanel/index.tsx')
let root: Root | null = null
let client: QueryClient | null = null
const editorNonce = 'default_site_editor_nonce'
const hadPreviousNonce = Object.hasOwn(globalThis, '__webpack_nonce__')
const previousNonce = Reflect.get(globalThis, '__webpack_nonce__')

beforeEach(() => setClientCspNonce(editorNonce))

async function renderPanel(canUpdate = true, existingContainer?: HTMLElement, hidden = false) {
    const container = existingContainer ?? document.createElement('div')
    if (!root) {
        document.body.append(container)
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        root = createRoot(container)
    }
    await act(async () => {
        root!.render(
            withTestLanguage(
                withTestPageAlerts(
                    <ToastProvider {...TOAST_PROVIDER_PROPS}>
                        <InputProvider {...INPUT_PROVIDER_PROPS}>
                            <QueryClientProvider client={client!}>
                                <Activity mode={hidden ? 'hidden' : 'visible'}>
                                    <DefaultSitePanel canUpdate={canUpdate} />
                                </Activity>
                            </QueryClientProvider>
                        </InputProvider>
                    </ToastProvider>,
                ),
            ),
        )
    })
    await waitForPanel(container)
    return container
}

async function waitForPanel(container: HTMLElement) {
    const deadline = Date.now() + 2000
    while (true) {
        const form = container.querySelector('form')
        const mode = container.querySelector<HTMLInputElement>('input[name="mode"]')?.value
        if (
            (form && (mode !== 'custom-html' || container.querySelector('#default-site-html'))) ||
            (!form && container.querySelector('button[data-severity="error"]'))
        )
            return
        if (Date.now() >= deadline)
            throw new Error('Default-site panel or HTML editor did not load.')
        // oxlint-disable-next-line no-await-in-loop -- React must finish each render before polling the lazy editor again.
        await settle()
    }
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await settle()
}

async function chooseMode(container: HTMLElement, label: string) {
    await click(container.querySelector('[role="combobox"]')!)
    const option = [...document.querySelectorAll('[role="option"]')].find((candidate) =>
        candidate.textContent?.includes(label),
    )
    expect(option).toBeDefined()
    await click(option!)
    await waitForPanel(container)
}

async function submit(container: HTMLElement) {
    await act(async () => {
        container
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        const prototype =
            input instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
    })
}

function getEditor(container: HTMLElement) {
    const element = container.querySelector<HTMLElement>('.cm-editor')
    expect(element).not.toBeNull()
    const view = EditorView.findFromDOM(element!)
    expect(view).not.toBeNull()
    return view!
}

async function setHtml(container: HTMLElement, value: string) {
    await act(async () => {
        const view = getEditor(container)
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
            userEvent: 'input',
        })
    })
}

function formatButton(container: HTMLElement) {
    return [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Format HTML'),
    )!
}

async function chooseEditorColors(container: HTMLElement, label: string) {
    await click(container.querySelector('[aria-label="Editor colors"]')!)
    const option = [...document.querySelectorAll('[role="option"]')].find((candidate) =>
        candidate.textContent?.includes(label),
    )
    expect(option).toBeDefined()
    await click(option!)
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    toast.dismissAll()
    document.body.replaceChildren()
    saved = { baseRevision: 'revision-1', settings: { mode: 'not-found' } }
    outcome = { success: true, message: 'defaultSite.saved', runtimeStatus: 'applied' }
    getSettings.mockClear()
    saveSettings.mockClear()
    formatSettings.mockClear()
    formatOutcome = { success: true, html: '<p>formatted</p>\n' }
    if (hadPreviousNonce) Reflect.set(globalThis, '__webpack_nonce__', previousNonce)
    else Reflect.deleteProperty(globalThis, '__webpack_nonce__')
})

describe('default-site settings panel', () => {
    test('hides navigation without view permission and requires update plus apply to edit', async () => {
        const user: AuthenticatedUser = {
            id: 'viewer',
            displayName: 'Viewer',
            email: 'viewer@example.test',
            roles: ['Viewer'],
            permissions: [PERMISSIONS.ACCOUNT_VIEW, PERMISSIONS.DEFAULT_SITE_UPDATE],
            language: 'en',
            themeMode: 'light',
            profileImageVersion: null,
        }
        const route = createRootRoute({
            component: () => (
                <ApplicationNavigation
                    items={getApplicationShellViewModel(user, (key) => key).navigationItems}
                />
            ),
        })
        const router = createRouter({
            routeTree: route,
            history: createMemoryHistory({ initialEntries: ['/'] }),
        })
        await router.load()
        expect(renderToString(withTestLanguage(<RouterProvider router={router} />))).not.toContain(
            'href="/operations"',
        )
        expect(getDefaultSitePageViewModel(user.permissions).canView).toBe(false)
        expect(getDefaultSitePageViewModel(user.permissions).canUpdate).toBe(false)
        const editor = {
            ...user,
            permissions: [
                PERMISSIONS.DEFAULT_SITE_VIEW,
                PERMISSIONS.DEFAULT_SITE_UPDATE,
                PERMISSIONS.PROXY_HOSTS_APPLY,
            ],
        }
        expect(getDefaultSitePageViewModel(editor.permissions).canView).toBe(true)
        expect(getDefaultSitePageViewModel(editor.permissions).canUpdate).toBe(true)
        expect(getSettings).not.toHaveBeenCalled()
    })
    test('mounts an editable empty codebox with nonce-authorized styles and saves its draft', async () => {
        const container = await renderPanel()
        await chooseMode(container, 'Custom HTML')
        const view = getEditor(container)
        expect(view.state.doc.toString()).toBe('')
        expect(view.state.readOnly).toBe(false)
        expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')
        expect(view.contentDOM.getAttribute('aria-readonly')).toBe('false')
        expect(view.state.facet(EditorView.cspNonce)).toBe(editorNonce)
        const editorStyles = [...document.querySelectorAll('style')].filter((style) =>
            style.textContent?.includes('.cm-content'),
        )
        expect(editorStyles.length).toBeGreaterThan(0)
        expect(editorStyles.map((style) => style.getAttribute('nonce'))).toEqual(
            editorStyles.map(() => editorNonce),
        )
        const html = '<h1>RentnerProxy</h1>\n<p>End of the road.</p>'
        await setHtml(container, html)
        await chooseEditorColors(container, 'Midnight')
        expect(getEditor(container)).toBe(view)
        expect(view.state.doc.toString()).toBe(html)
        const themedEditorStyles = [...document.querySelectorAll('style')].filter((style) =>
            style.textContent?.includes('.cm-content'),
        )
        expect(themedEditorStyles.length).toBeGreaterThan(0)
        expect(themedEditorStyles.map((style) => style.getAttribute('nonce'))).toEqual(
            themedEditorStyles.map(() => editorNonce),
        )
        expect(container.textContent).toContain('Unsaved changes')
        await submit(container)
        expect(saveSettings).toHaveBeenCalledWith({
            data: { baseRevision: 'revision-1', settings: { mode: 'custom-html', html } },
        })
    })

    test('keeps arbitrary HTML literal and makes viewers read only', async () => {
        const html = '<h1 id="untrusted">Hi</h1><script>window.hacked=true</script>'
        saved = { baseRevision: 'revision-1', settings: { mode: 'custom-html', html } }
        const container = await renderPanel(false)
        expect(getEditor(container).state.doc.toString()).toBe(html)
        expect(getEditor(container).state.readOnly).toBe(true)
        expect(getEditor(container).contentDOM.getAttribute('contenteditable')).toBe('false')
        expect(container.querySelector('[role="textbox"]')?.getAttribute('aria-readonly')).toBe(
            'true',
        )
        expect(formatButton(container).disabled).toBe(true)
        expect(container.querySelector('#untrusted')).toBeNull()
        expect(container.querySelector('script')).toBeNull()
        expect(container.querySelector('button[type="submit"]')).toBeNull()
        await submit(container)
        await settle()
        await settle()
        expect(saveSettings).not.toHaveBeenCalled()
    })

    test.each([true, false])(
        'clean editor or viewer follows live data with update permission %s',
        async (canUpdate) => {
            const container = await renderPanel(canUpdate)
            saved = {
                baseRevision: 'revision-live',
                settings: { mode: 'redirect', url: 'https://live.example/' },
            }
            await act(async () => {
                await client!.invalidateQueries({ queryKey: ['default-site'] })
            })
            await settle()
            expect(container.querySelector<HTMLInputElement>('input[name="url"]')?.value).toBe(
                'https://live.example/',
            )
            expect(container.textContent).toContain('Saved: Redirect')
            expect(container.textContent).not.toContain('Reload')
            expect(saveSettings).not.toHaveBeenCalled()
        },
    )

    test('saves mode changes with the loaded revision and reports pending honestly', async () => {
        const warning = spyOn(toast, 'warning')
        outcome = { success: true, message: 'defaultSite.savedPending', runtimeStatus: 'pending' }
        const container = await renderPanel()
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            true,
        )
        await chooseMode(container, 'Welcome page')
        expect(container.textContent).toContain('Unsaved changes')
        await submit(container)
        expect(saveSettings).toHaveBeenCalledWith({
            data: { baseRevision: 'revision-1', settings: { mode: 'welcome' } },
        })
        expect(container.textContent).toContain('Saved: Welcome page')
        expect(container.textContent).not.toContain('Runtime application is pending')
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            'Runtime application is pending',
        )
        expect(warning).toHaveBeenCalledWith(catalogs.en.defaultSite.pending, {
            title: catalogs.en.toast.titles.warning,
            duration: 0,
        })
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            catalogs.en.toast.titles.warning,
        )
        warning.mockRestore()
        expect(container.querySelector('button[data-severity]')).toBeNull()
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            true,
        )
    })

    test('keeps a draft editable and reports a thrown save failure through one toast', async () => {
        const container = await renderPanel()
        await chooseMode(container, 'Welcome page')
        saveSettings.mockRejectedValueOnce(new Error('private diagnostic'))
        await submit(container)
        expect(container.querySelector('[role="alert"]')).toBeNull()
        expect(document.querySelectorAll('.rentnerproxy-toast-error')).toHaveLength(1)
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Could not save',
        )
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            catalogs.en.toast.titles.error,
        )
        expect(container.textContent).not.toContain('private diagnostic')
        expect(container.textContent).toContain('Unsaved changes')
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            false,
        )
    })

    test('retains the HTML draft through a conflict and discards locally to the latest cached state', async () => {
        saved = {
            baseRevision: 'revision-1',
            settings: { mode: 'custom-html', html: '<p>draft</p>' },
        }
        outcome = { success: false, message: 'defaultSite.errors.conflict' }
        const container = await renderPanel()
        await chooseMode(container, 'Welcome page')
        await chooseMode(container, 'Custom HTML')
        expect(getEditor(container).state.doc.toString()).toBe('<p>draft</p>')
        await chooseMode(container, 'Close connection')
        await submit(container)
        expect(container.querySelector('[role="alert"]')).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Saved settings changed',
        )
        saved = {
            baseRevision: 'revision-3',
            settings: { mode: 'redirect', url: 'https://example.test/' },
        }
        await act(async () => {
            await client!.invalidateQueries({ queryKey: ['default-site'] })
        })
        await settle()
        const readsBeforeDiscard = getSettings.mock.calls.length
        await click(
            [...container.querySelectorAll('button')].find((button) =>
                button.textContent?.includes('Discard changes'),
            )!,
        )
        expect(getSettings.mock.calls.length).toBe(readsBeforeDiscard)
        expect(container.querySelector<HTMLInputElement>('input[name="url"]')?.value).toBe(
            'https://example.test/',
        )
        expect(
            container.querySelector(
                'section[aria-labelledby="default-site-heading"] [role="alert"]',
            ),
        ).toBeNull()
    })

    test('clears a normalized equivalent redirect draft when refetch retains the same revision', async () => {
        saved = {
            baseRevision: 'revision-1',
            settings: { mode: 'redirect', url: 'https://example.com/' },
        }
        saveSettings.mockImplementationOnce(async () => ({
            success: true,
            message: 'defaultSite.saved',
            runtimeStatus: 'applied',
        }))
        const container = await renderPanel()
        const cached = client!.getQueryData<DefaultSiteEditorData>(['default-site'])
        await setInputValue(
            container.querySelector<HTMLInputElement>('input[name="url"]')!,
            ' https://example.com:443/ ',
        )
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            false,
        )
        await submit(container)
        expect(saveSettings).toHaveBeenCalledWith({
            data: {
                baseRevision: 'revision-1',
                settings: { mode: 'redirect', url: 'https://example.com/' },
            },
        })
        expect(client!.getQueryData<DefaultSiteEditorData>(['default-site'])).toBe(cached)
        expect(container.querySelector<HTMLInputElement>('input[name="url"]')?.value).toBe(
            'https://example.com/',
        )
        expect(container.textContent).toContain('No unsaved changes')
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            true,
        )
    })

    test.each(['redirect', 'custom-html'] as const)(
        'preserves a dirty %s draft and its baseline revision during live invalidation',
        async (mode) => {
            saved = {
                baseRevision: 'revision-1',
                settings:
                    mode === 'redirect'
                        ? { mode, url: 'https://original.example/' }
                        : { mode, html: '<p>original</p>' },
            }
            const container = await renderPanel()
            const draft = mode === 'redirect' ? 'https://draft.example/' : '<p>unsaved draft</p>'
            const readDraft = () =>
                mode === 'redirect'
                    ? container.querySelector<HTMLInputElement>('input[name="url"]')?.value
                    : getEditor(container).state.doc.toString()
            if (mode === 'redirect')
                await setInputValue(
                    container.querySelector<HTMLInputElement>('input[name="url"]')!,
                    draft,
                )
            else await setHtml(container, draft)
            saved = { baseRevision: 'revision-2', settings: { mode: 'welcome' } }
            await act(async () => {
                await client!.invalidateQueries({ queryKey: ['default-site'] })
            })
            await settle()
            expect(
                client!.getQueryData<DefaultSiteEditorData>(['default-site'])?.baseRevision,
            ).toBe('revision-2')
            expect(readDraft()).toBe(draft)
            expect(container.textContent).toContain('Unsaved changes')
            outcome = { success: false, message: 'defaultSite.errors.conflict' }
            await submit(container)
            expect(saveSettings).toHaveBeenCalledWith({
                data: {
                    baseRevision: 'revision-1',
                    settings: mode === 'redirect' ? { mode, url: draft } : { mode, html: draft },
                },
            })
            expect(readDraft()).toBe(draft)
            expect(container.querySelector('[role="alert"]')).toBeNull()
            expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
                'Saved settings changed',
            )
        },
    )

    test('keeps HTML completion, folding, indentation, history and keyboard search available', async () => {
        const html = '<section>\n<p>original</p>\n</section>'
        saved = { baseRevision: 'revision-1', settings: { mode: 'custom-html', html } }
        const container = await renderPanel()
        const view = getEditor(container)
        expect(container.querySelector('.cm-lineNumbers')).not.toBeNull()
        expect(container.querySelector('.cm-foldGutter')).not.toBeNull()
        expect(view.state.languageDataAt('autocomplete', 1).length).toBeGreaterThan(0)
        const { foldCode, unfoldCode } = await import('@codemirror/language')
        const { indentMore, undo, redo } = await import('@codemirror/commands')
        await act(async () => {
            expect(foldCode(view)).toBe(true)
        })
        expect(container.querySelector('.cm-foldPlaceholder')).not.toBeNull()
        await act(async () => {
            expect(unfoldCode(view)).toBe(true)
            view.dispatch({ selection: { anchor: html.indexOf('<p>') } })
            expect(indentMore(view)).toBe(true)
        })
        expect(view.state.doc.toString()).toContain('  <p>original</p>')
        await act(async () => {
            expect(undo(view)).toBe(true)
        })
        expect(view.state.doc.toString()).toBe(html)
        await act(async () => {
            expect(redo(view)).toBe(true)
        })
        expect(view.state.doc.toString()).toContain('  <p>original</p>')
        await act(async () => {
            view.contentDOM.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'f',
                    code: 'KeyF',
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })
        expect(container.querySelector('.cm-search input[name="search"]')).not.toBeNull()
    })

    test('changes only editor colors and keeps undo history through theme changes', async () => {
        const html = '<p>original</p>'
        saved = { baseRevision: 'revision-1', settings: { mode: 'custom-html', html } }
        const container = await renderPanel()
        const view = getEditor(container)
        await chooseEditorColors(container, 'Midnight')
        expect(getEditor(container)).toBe(view)
        expect(view.state.doc.toString()).toBe(html)
        expect(container.textContent).toContain('No unsaved changes')
        await setHtml(container, '<p>draft</p>')
        await chooseEditorColors(container, 'Paper')
        expect(getEditor(container)).toBe(view)
        expect(container.querySelector('[data-color-preset="paper"]')).not.toBeNull()
        await act(async () => {
            view.contentDOM.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'z',
                    code: 'KeyZ',
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })
        expect(view.state.doc.toString()).toBe(html)
        expect(container.textContent).toContain('No unsaved changes')
        expect(saveSettings).not.toHaveBeenCalled()
    })

    test('formats embedded CSS as an undoable draft without saving', async () => {
        const html = '<style>h1{color:red;margin:0}</style>\n<h1>Welcome</h1>'
        formatOutcome = {
            success: true,
            html: '<style>\n    h1 {\n        color: red;\n        margin: 0;\n    }\n</style>\n<h1>Welcome</h1>\n',
        }
        saved = { baseRevision: 'revision-1', settings: { mode: 'custom-html', html } }
        const container = await renderPanel()
        await click(formatButton(container))
        expect(formatSettings).toHaveBeenCalledWith({ data: html })
        expect(getEditor(container).state.doc.toString()).toContain('color: red;')
        expect(container.textContent).toContain('Unsaved changes')
        expect(saveSettings).not.toHaveBeenCalled()
        await act(async () => {
            getEditor(container).contentDOM.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'z',
                    code: 'KeyZ',
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })
        expect(getEditor(container).state.doc.toString()).toBe(html)
        await click(formatButton(container))
        await submit(container)
        expect(saveSettings).toHaveBeenCalledWith({
            data: {
                baseRevision: 'revision-1',
                settings: { mode: 'custom-html', html: getEditor(container).state.doc.toString() },
            },
        })
    })

    test('preserves the source and shows a useful error when formatting fails', async () => {
        const html = '<div><span>private draft</div>'
        formatOutcome = { success: false, message: 'defaultSite.editor.formatFailed' }
        saved = { baseRevision: 'revision-1', settings: { mode: 'custom-html', html } }
        const container = await renderPanel()
        await click(formatButton(container))
        expect(getEditor(container).state.doc.toString()).toBe(html)
        expect(container.querySelector('[role="alert"]')).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
            'Could not format HTML',
        )
        expect(saveSettings).not.toHaveBeenCalled()
    })

    test('does not overwrite typing that happens while formatting is in flight', async () => {
        saved = {
            baseRevision: 'revision-1',
            settings: { mode: 'custom-html', html: '<p>original</p>' },
        }
        let finish!: (result: DefaultSiteFormatResult) => void
        formatSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve
                }),
        )
        const container = await renderPanel()
        await click(formatButton(container))
        await setHtml(container, '<p>new typing</p>')
        await act(async () => {
            finish({ success: true, html: '<p>original</p>\n' })
        })
        expect(getEditor(container).state.doc.toString()).toBe('<p>new typing</p>')
        expect(container.querySelector('[role="alert"]')).toBeNull()
        expect(document.querySelector('.rentnerproxy-toast-warning')?.textContent).toContain(
            'HTML changed during formatting',
        )
        expect(saveSettings).not.toHaveBeenCalled()
    })

    test('recovers a failed load through automatic invalidation without a retry button', async () => {
        getSettings.mockRejectedValueOnce(new Error('offline'))
        const container = await renderPanel()
        expect(
            container.querySelector(
                'section[aria-labelledby="default-site-heading"] [role="alert"]',
            ),
        ).toBeNull()
        expect(container.querySelector('button[data-severity="error"]')).not.toBeNull()
        const panel = container.querySelector('section[aria-labelledby="default-site-heading"]')!
        expect(panel.textContent).toContain('Could not load the default site.')
        expect(
            [...panel.querySelectorAll('button')].some((button) =>
                button.textContent?.includes('Try again'),
            ),
        ).toBe(false)
        await act(async () => {
            await client!.invalidateQueries({ queryKey: ['default-site'] })
        })
        await settle()
        expect(
            container.querySelector(
                'section[aria-labelledby="default-site-heading"] [role="alert"]',
            ),
        ).toBeNull()
        expect(container.textContent).toContain('Saved: 404 Not found')
    })
})

for (const transition of ['unmount', 'permission'] as const) {
    for (const response of ['success', 'error', 'reject'] as const) {
        test(`suppresses save ${response} feedback after ${transition} and reconciles successful writes`, async () => {
            let resolve!: (value: DefaultSiteSaveResult) => void
            let reject!: (error: Error) => void
            saveSettings.mockImplementationOnce(
                () =>
                    new Promise((done, fail) => {
                        resolve = done
                        reject = fail
                    }),
            )
            const success = spyOn(toast, 'success')
            const error = spyOn(toast, 'error')
            const warning = spyOn(toast, 'warning')
            try {
                const container = await renderPanel()
                await chooseMode(container, 'Welcome page')
                await submit(container)
                if (transition === 'unmount') {
                    await act(async () => root?.unmount())
                    root = null
                } else await renderPanel(false, container)
                await act(async () => {
                    if (response === 'success') {
                        saved = { baseRevision: 'revision-2', settings: { mode: 'welcome' } }
                        resolve({
                            success: true,
                            message: 'defaultSite.saved',
                            runtimeStatus: 'applied',
                        })
                    } else if (response === 'error')
                        resolve({ success: false, message: 'defaultSite.errors.conflict' })
                    else reject(new Error('private save failure'))
                })
                await settle()
                expect(success).not.toHaveBeenCalled()
                expect(error).not.toHaveBeenCalled()
                expect(warning).not.toHaveBeenCalled()
                if (response === 'success') {
                    expect(
                        client!.getQueryData<DefaultSiteEditorData>(['default-site'])?.baseRevision,
                    ).toBe('revision-2')
                }
            } finally {
                success.mockRestore()
                error.mockRestore()
                warning.mockRestore()
            }
        })
    }
}

test('applied saves report their localized title and body once', async () => {
    const success = spyOn(toast, 'success')
    try {
        const container = await renderPanel()
        await chooseMode(container, 'Welcome page')
        await submit(container)
        expect(success).toHaveBeenCalledTimes(1)
        expect(success).toHaveBeenCalledWith(catalogs.en.defaultSite.saved, {
            title: catalogs.en.toast.titles.success,
        })
    } finally {
        success.mockRestore()
    }
})

test('does not announce a formatting rejection after the editor becomes disabled', async () => {
    saved = { baseRevision: 'revision-1', settings: { mode: 'custom-html', html: '<p>draft</p>' } }
    let reject!: (error: Error) => void
    formatSettings.mockImplementationOnce(
        () =>
            new Promise((_done, fail) => {
                reject = fail
            }),
    )
    const error = spyOn(toast, 'error')
    try {
        const container = await renderPanel()
        await click(formatButton(container))
        await renderPanel(false, container)
        await act(async () => reject(new Error('private formatter failure')))
        await settle()
        expect(error).not.toHaveBeenCalled()
        expect(getEditor(container).state.doc.toString()).toBe('<p>draft</p>')
        expect(getEditor(container).contentDOM.getAttribute('aria-readonly')).toBe('true')
    } finally {
        error.mockRestore()
    }
})

test('reconciles a successful save across temporary Activity hiding without stale feedback', async () => {
    let resolve!: (value: DefaultSiteSaveResult) => void
    saveSettings.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done
            }),
    )
    const success = spyOn(toast, 'success')
    try {
        const container = await renderPanel()
        await chooseMode(container, 'Welcome page')
        await submit(container)
        await renderPanel(true, container, true)
        await act(async () => {
            saved = { baseRevision: 'revision-2', settings: { mode: 'welcome' } }
            resolve({ success: true, message: 'defaultSite.saved', runtimeStatus: 'applied' })
        })
        await settle()
        await renderPanel(true, container)
        await settle()
        expect(success).not.toHaveBeenCalled()
        expect(client!.getQueryData<DefaultSiteEditorData>(['default-site'])?.baseRevision).toBe(
            'revision-2',
        )
        expect(container.textContent).toContain('No unsaved changes')
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            true,
        )
        await chooseMode(container, 'Close connection')
        await submit(container)
        expect(saveSettings.mock.calls.at(-1)?.[0].data.baseRevision).toBe('revision-2')
        expect(success).toHaveBeenCalledWith(catalogs.en.defaultSite.saved, {
            title: catalogs.en.toast.titles.success,
        })
    } finally {
        success.mockRestore()
    }
})

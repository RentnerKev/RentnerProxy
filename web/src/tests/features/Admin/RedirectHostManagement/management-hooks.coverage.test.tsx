// oxlint-disable no-await-in-loop -- Mutation outcomes share one mounted hook and must settle in order.
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import renderLogicHook from '@/tests/Helpers/renderLogicHook.tsx'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { redirectHostManagementQueryKeys } from '@/lib/Admin/RedirectHostManagement/redirectHostManagementCache.ts'
import type {
    RedirectHostActionResult,
    RedirectHostSummary,
} from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
import { toast } from '@rentnerkev/toasts'
const host: RedirectHostSummary = {
    id: 'redirect-1',
    domains: ['old.example.com'],
    destination: 'https://example.com',
    statusCode: 308,
    preserveRequestUri: true,
    enabled: true,
    certificateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
}
const success: RedirectHostActionResult = {
    success: true,
    message: 'saved',
    runtimeStatus: 'applied',
}
const page = mock(async (_input: unknown) => ({
    hosts: [host],
    total: 1,
    tags: [],
    domains: host.domains,
}))
const runtime = mock(async () => ({ available: true, state: 'synced' }))
const createHost = mock(async (_input: unknown): Promise<RedirectHostActionResult> => success)
const updateHost = mock(async (_input: unknown): Promise<RedirectHostActionResult> => success)
const certificates = mock(async () => [])
const apply = mock(async (): Promise<RedirectHostActionResult> => success)
const remove = mock(async (_input: unknown): Promise<RedirectHostActionResult> => success)
const disable = mock(async (_input: unknown): Promise<RedirectHostActionResult> => success)
const enable = mock(async (_input: unknown): Promise<RedirectHostActionResult> => success)
mock.module('@/features/Admin/RedirectHostManagement/middleware.ts', () => ({
    createRedirectHostHandler: createHost,
    updateRedirectHostHandler: updateHost,
    getAssignableRedirectCertificatesHandler: certificates,
    getRedirectHostPageHandler: page,
    getRedirectRuntimeStatusHandler: runtime,
    applyRedirectConfigurationHandler: apply,
    deleteRedirectHostHandler: remove,
    disableRedirectHostHandler: disable,
    enableRedirectHostHandler: enable,
}))
mock.module('@/features/Admin/HostTags/middleware.ts', () => ({
    getHostTagCatalogHandler: async () => ({ revision: 0, tags: [] }),
    mutateHostTagHandler: async () => ({ success: true, value: { revision: 1, tags: [] } }),
}))
mock.module('@/shared/Live/Hooks/useLiveInvalidation.ts', () => ({ default: () => undefined }))
const { default: useManagement } =
    await import('@/features/Admin/RedirectHostManagement/Hooks/useRedirectHostManagementLogic.ts')
const { default: useForm } =
    await import('@/features/Admin/RedirectHostManagement/Components/RedirectHostFormModal/Hooks/useRedirectHostFormModalLogic.ts')
const { default: useTable } =
    await import('@/features/Admin/RedirectHostManagement/Components/RedirectHostsTable/Hooks/useRedirectHostsTableLogic.ts')
let dispose: (() => Promise<void>) | undefined
beforeEach(() => {
    page.mockClear()
    runtime.mockClear()
    for (const action of [apply, remove, disable, enable, createHost, updateHost]) {
        action.mockReset()
        action.mockResolvedValue(success)
    }
    spyOn(toast, 'success').mockImplementation(() => '')
    spyOn(toast, 'error').mockImplementation(() => '')
    spyOn(toast, 'warning').mockImplementation(() => '')
})
afterEach(async () => {
    await dispose?.()
    dispose = undefined
    mock.restore()
})

test('redirect manager keeps domain inspection current, edits and duplicates mutually exclusive, and closes canceled dialogs', async () => {
    const hook = await renderLogicHook(() =>
        useManagement({ permissions: Object.values(PERMISSIONS) }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isLoading)
    expect(page).toHaveBeenCalledWith({ data: expect.objectContaining({ locale: 'en' }) })
    await hook.run((value) => value.handler.openDomainCheck(host))
    expect(hook.current.state.domainCheckTarget).toEqual(host)
    const updated = { ...host, destination: 'https://updated.example.com' }
    const activePage = hook.client
        .getQueryCache()
        .findAll({ queryKey: redirectHostManagementQueryKeys.all })
        .find((query) => query.queryKey.includes('page'))
    if (!activePage) throw new Error('Missing redirect page query')
    await hook.run(() =>
        hook.client.setQueryData(activePage.queryKey, {
            hosts: [updated],
            total: 1,
            tags: [],
            domains: host.domains,
        }),
    )
    expect(hook.current.state.domainCheckTarget?.destination).toBe(updated.destination)
    await hook.run(() =>
        hook.client.setQueryData(activePage.queryKey, {
            hosts: [],
            total: 0,
            tags: [],
            domains: [],
        }),
    )
    expect(hook.current.state.domainCheckTarget?.destination).toBe(updated.destination)
    await hook.run((value) => value.handler.setDomainCheckOpen(true))
    await hook.run((value) => value.handler.setDomainCheckOpen(false))
    expect(hook.current.state.domainCheckTarget).toBeNull()
    await hook.run((value) => value.handler.openCreate())
    expect(hook.current.state.showCreate).toBe(true)
    await hook.run((value) => value.handler.openEditor(host))
    expect(hook.current.state.selected).toEqual(host)
    await hook.run((value) => value.handler.openDuplicate(host))
    expect(hook.current.state.selected).toBeNull()
    expect(hook.current.state.duplicateSource).toEqual(host)
    await hook.run((value) => value.handler.setDuplicateOpen(true))
    await hook.run((value) => value.handler.setDuplicateOpen(false))
    expect(hook.current.state.duplicateSource).toBeNull()
    await hook.run((value) => value.handler.openEditor(host))
    await hook.run((value) => value.handler.setEditorOpen(true))
    await hook.run((value) => value.handler.setEditorOpen(false))
    expect(hook.current.state.selected).toBeNull()
    await hook.run((value) => {
        value.handler.retry()
        value.handler.retryRuntime()
        value.handler.handleFormSuccess()
    })
    expect(hook.current.state.showCreate).toBe(false)
    await hook.run((value) =>
        value.state.remote.onStateChange({
            ...value.state.remote.initialState,
            globalFilter: 'updated',
            columnFilters: [],
            sorting: [],
            pagination: { pageIndex: 1, pageSize: 20 },
        }),
    )
    expect(page).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ search: 'updated', pageIndex: 1 }),
    })
})

test('redirect actions preserve failed dialogs, send precise ids and invalidate runtime or host caches on success', async () => {
    const hook = await renderLogicHook(() =>
        useManagement({ permissions: Object.values(PERMISSIONS) }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isLoading)
    const invalidate = spyOn(hook.client, 'invalidateQueries')
    await hook.run((value) => value.handler.confirmDelete())
    await hook.run((value) => value.handler.confirmDisable())
    expect(remove).not.toHaveBeenCalled()
    expect(disable).not.toHaveBeenCalled()
    for (const action of ['delete', 'disable', 'enable', 'apply'] as const) {
        const transport =
            action === 'delete'
                ? remove
                : action === 'disable'
                  ? disable
                  : action === 'enable'
                    ? enable
                    : apply
        for (const outcome of ['failure', 'exception', 'pending', 'applied']) {
            if (outcome === 'failure')
                transport.mockResolvedValueOnce({ success: false, message: 'denied' })
            if (outcome === 'exception') transport.mockRejectedValueOnce(new Error('offline'))
            if (outcome === 'pending')
                transport.mockResolvedValueOnce({ ...success, runtimeStatus: 'pending' })
            if (action === 'delete') await hook.run((value) => value.handler.openDelete(host))
            if (action === 'disable') await hook.run((value) => value.handler.openDisable(host))
            await hook.run((value) =>
                action === 'delete'
                    ? value.handler.confirmDelete()
                    : action === 'disable'
                      ? value.handler.confirmDisable()
                      : action === 'enable'
                        ? value.handler.enable(host)
                        : value.handler.apply(),
            )
            await hook.waitFor((value) => !value.state.isApplying && !value.state.isMutating)
            if (action === 'delete')
                expect(hook.current.state.deleteTarget).toEqual(
                    outcome === 'failure' || outcome === 'exception' ? host : null,
                )
            if (action === 'disable')
                expect(hook.current.state.disableTarget).toEqual(
                    outcome === 'failure' || outcome === 'exception' ? host : null,
                )
        }
        if (action !== 'apply')
            expect(transport).toHaveBeenLastCalledWith({ data: { redirectHostId: host.id } })
    }
    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: redirectHostManagementQueryKeys.all })
    expect(invalidate).toHaveBeenCalledWith({
        queryKey: redirectHostManagementQueryKeys.runtimeStatus,
    })
    await hook.run((value) => {
        value.handler.openDelete(host)
        value.handler.openDisable(host)
    })
    await hook.run((value) => {
        value.handler.setDeleteOpen(true)
        value.handler.setDisableOpen(true)
    })
    await hook.run((value) => {
        value.handler.setDeleteOpen(false)
        value.handler.setDisableOpen(false)
    })
    expect(hook.current.state.deleteTarget).toBeNull()
    expect(hook.current.state.disableTarget).toBeNull()
})

test('a redirect viewer without creation cannot duplicate, and missing view permission prevents data and domain checks', async () => {
    const hook = await renderLogicHook(() => useManagement({ permissions: [] }))
    dispose = hook.dispose
    expect(hook.current.state.canDuplicate(host)).toBe(false)
    await hook.run((value) => {
        value.handler.openDuplicate(host)
        value.handler.openDomainCheck(host)
    })
    expect(hook.current.state.duplicateSource).toBeNull()
    expect(hook.current.state.domainCheckTarget).toBeNull()
    expect(page).not.toHaveBeenCalled()
    expect(runtime).not.toHaveBeenCalled()
})

test('redirect edit snapshots disabling values for confirmation and retains the confirmation after network rejection', async () => {
    const saved = mock(() => undefined)
    const hook = await renderLogicHook(
        () =>
            useForm({
                canEnable: true,
                canDisable: true,
                canAssignCertificates: true,
                mode: 'edit',
                onSuccess: saved,
                redirectHost: host,
            }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.assignableCertificatesLoading)
    await hook.run((value) => value.handler.confirmDisable())
    expect(updateHost).not.toHaveBeenCalled()
    await hook.run((value) => value.form.setFieldValue('enabled', false))
    const submit = () =>
        hook.run(() =>
            hook.container
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
    await submit()
    await hook.waitFor((value) => value.state.disableConfirmationOpen)
    expect(updateHost).not.toHaveBeenCalled()
    await hook.run((value) => value.handler.setDisableConfirmationOpen(true))
    await hook.run((value) => value.handler.setDisableConfirmationOpen(false))
    expect(hook.current.state.disableConfirmationOpen).toBe(false)
    await submit()
    await hook.waitFor((value) => value.state.disableConfirmationOpen)
    updateHost.mockResolvedValueOnce({ success: false, message: 'denied' })
    await hook.run((value) => value.handler.confirmDisable())
    expect(hook.current.state.disableConfirmationOpen).toBe(true)
    updateHost.mockRejectedValueOnce(new Error('offline'))
    await hook.run((value) => value.handler.confirmDisable())
    expect(saved).not.toHaveBeenCalled()
    updateHost.mockResolvedValueOnce({ ...success, runtimeStatus: 'pending' })
    await hook.run((value) => value.handler.confirmDisable())
    expect(updateHost).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
            redirectHostId: host.id,
            enabled: false,
            domains: host.domains,
        }),
    })
    expect(hook.current.state.disableConfirmationOpen).toBe(false)
    expect(saved).toHaveBeenCalledTimes(1)
    await hook.run((value) => value.handler.retryAssignableCertificates())
    expect(certificates).toHaveBeenCalled()
})

test('redirect table filters domains and tags through row models and clears bulk selection when filters change', async () => {
    const tagged = { ...host, tags: [{ id: 'tag-1', name: 'Production' }] }
    const other = {
        ...host,
        id: 'redirect-2',
        domains: ['other.example.com'],
        enabled: false,
        tags: [],
    }
    const hook = await renderLogicHook(() =>
        useTable({
            redirectHosts: [tagged, other],
            loading: false,
            canUpdate: false,
            canDelete: false,
            canEnable: false,
            canDisable: false,
            isPending: false,
            bulkPermissions: [PERMISSIONS.REDIRECT_HOSTS_ENABLE],
            onEdit: () => undefined,
            onDelete: () => undefined,
            onDisable: () => undefined,
            onEnable: () => undefined,
        }),
    )
    dispose = hook.dispose
    await hook.run((value) => value.handler.handleSelectPage())
    expect(hook.current.state.bulkIds).toHaveLength(2)
    await hook.run((value) => value.table.setColumnFilters([{ id: 'tags', value: 'tag-1' }]))
    expect(hook.current.table.getRowModel().rows.map((row) => row.id)).toEqual([host.id])
    expect(hook.current.state.bulkIds).toHaveLength(0)
    await hook.run((value) => value.table.setColumnFilters([{ id: 'tags', value: 'untagged' }]))
    expect(hook.current.table.getRowModel().rows.map((row) => row.id)).toEqual([other.id])
    await hook.run((value) =>
        value.table.setColumnFilters([{ id: 'domains', value: 'old.example.com' }]),
    )
    expect(hook.current.table.getRowModel().rows.map((row) => row.id)).toEqual([host.id])
    await hook.run((value) => value.handler.handleResetFilters())
    await hook.run((value) => value.table.setGlobalFilter('old.example'))
    expect(hook.current.table.getRowModel().rows.map((row) => row.id)).toEqual([host.id])
    await hook.run((value) => value.handler.toggleColumnFilters())
    expect(hook.current.state.showColumnFilters).toBe(true)
    await hook.run((value) => value.handler.handleClearSelection())
    expect(hook.current.state.bulkIds).toHaveLength(0)
})

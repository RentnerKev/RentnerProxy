import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { filterFn_equalsString } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { QueryClient as QueryClientInstance } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { PERMISSIONS, PERMISSION_REGISTRY } from '../config/permissions.config'
import { roleManagementQueryKeys } from '../features/Admin/RoleManagement/queryKeys'
import type { DateRangeValue } from '../shared/Calendar/Types/date-range-calendar.types'
import { createTrimmedIncludesStringFilter } from '../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../shared/Table/Hooks/useClientTableLogic'
import type { RoleManagementSummary, UserSummary } from '../shared/Types/auth.types'
import type { TableColumnFilterConfigs } from '../shared/Table/Types/table.types'
import withTestLanguage, { withLanguageRoot } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: RoleTableActions } =
    await import('../features/Admin/RoleManagement/Components/RoleTableActions')
const { default: UserTableActions } =
    await import('../features/Admin/UserManagement/Components/UserTableActions')
const { default: UsersTable } =
    await import('../features/Admin/UserManagement/Components/UsersTable')
const { default: RolesTable } =
    await import('../features/Admin/RoleManagement/Components/RolesTable')
const { ConfirmDialog } = await import('../shared/Modal/Components/ConfirmDialog')
const { default: DateRangeCalendar } = await import('../shared/Calendar')
const { default: DataTable } = await import('../shared/Table')
const { default: useClientTableLogic } = await import('../shared/Table/Hooks/useClientTableLogic')
const { TooltipProvider } = await import('../shared/Tooltip')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')

const createUserHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'User created.',
}))
const updateUserHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'User updated.',
}))
const createRoleHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'Role created.',
}))
const updateRoleHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'Role updated.',
}))

mock.module('../features/Admin/UserManagement/server', () => ({
    createUserHandler: createUserHandlerMock,
    updateUserHandler: updateUserHandlerMock,
}))
mock.module('../features/Admin/RoleManagement/server', () => ({
    createRoleHandler: createRoleHandlerMock,
    updateRoleHandler: updateRoleHandlerMock,
}))

const UserFormModal = (await import('../features/Admin/UserManagement/Components/UserFormModal'))
    .default
const RoleFormModal = (await import('../features/Admin/RoleManagement/Components/RoleFormModal'))
    .default

let activeRoot: Root | null = null
let activeQueryClient: QueryClientInstance | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = withLanguageRoot(createRoot(container))

    await act(async () => {
        activeRoot?.render(
            <TooltipProvider>
                <ToastProvider>{element}</ToastProvider>
            </TooltipProvider>,
        )
    })

    return container
}

function withQueryClient(element: ReactElement): ReactElement {
    activeQueryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })

    return <QueryClientProvider client={activeQueryClient}>{element}</QueryClientProvider>
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function openMenu(trigger: Element): Promise<void> {
    await act(async () => {
        trigger.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="menu"]') !== null)
}

async function chooseSelectOption(ariaLabel: string, optionLabel: string): Promise<void> {
    const trigger = getButton(ariaLabel)

    await act(async () => {
        trigger.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="listbox"]') !== null)

    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.textContent?.trim() === optionLabel,
    )
    expect(option).toBeDefined()

    await act(async () => {
        option?.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="listbox"]') === null)
}

async function setControlValue(
    control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    value: string,
): Promise<void> {
    await act(async () => {
        const prototype =
            control instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : control instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

        setter?.call(control, value)
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function blurControl(control: HTMLElement): Promise<void> {
    await act(async () => {
        control.focus()
        control.blur()
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const waitUntil = async (deadline: number): Promise<void> => {
        if (condition()) {
            return
        }

        if (Date.now() >= deadline) {
            expect(condition()).toBeTrue()
            return
        }

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })

        await waitUntil(deadline)
    }

    await waitUntil(Date.now() + timeoutMs)
}

function getButton(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) =>
            candidate.textContent?.trim().includes(label) ||
            candidate.getAttribute('aria-label') === label,
    )

    expect(button).toBeDefined()
    return button!
}

function getMenuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate) => candidate.textContent?.includes(label),
    )

    expect(item).toBeDefined()
    return item!
}

function getDataRows(): Array<HTMLTableRowElement> {
    return [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')]
}

beforeEach(() => {
    createUserHandlerMock.mockReset()
    updateUserHandlerMock.mockReset()
    createRoleHandlerMock.mockReset()
    updateRoleHandlerMock.mockReset()
    createUserHandlerMock.mockImplementation(async () => ({
        success: true,
        message: 'User created.',
    }))
    updateUserHandlerMock.mockImplementation(async () => ({
        success: true,
        message: 'User updated.',
    }))
    createRoleHandlerMock.mockImplementation(async () => ({
        success: true,
        message: 'Role created.',
    }))
    updateRoleHandlerMock.mockImplementation(async () => ({
        success: true,
        message: 'Role updated.',
    }))
})

afterEach(async () => {
    if (activeRoot) {
        await act(async () => {
            activeRoot?.unmount()
        })
    }

    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    document.body.replaceChildren()
})

interface TestRow {
    readonly id: string
    readonly name: string
    readonly status: 'active' | 'disabled'
}

const testRows: Array<TestRow> = [
    { id: '1', name: 'Zulu', status: 'active' },
    { id: '2', name: 'Alpha', status: 'disabled' },
    { id: '3', name: 'Kilo', status: 'active' },
    { id: '4', name: 'Bravo', status: 'disabled' },
    { id: '5', name: 'Juliet', status: 'active' },
    { id: '6', name: 'Charlie', status: 'disabled' },
    { id: '7', name: 'India', status: 'active' },
    { id: '8', name: 'Delta', status: 'disabled' },
    { id: '9', name: 'Hotel', status: 'active' },
    { id: '10', name: 'Echo', status: 'disabled' },
    { id: '11', name: 'Golf', status: 'active' },
    { id: '12', name: 'Foxtrot', status: 'disabled' },
]
const testTextFilter = createTrimmedIncludesStringFilter<TestRow>()
const testColumns: Array<ColumnDef<ClientTableFeatures, TestRow>> = [
    {
        accessorKey: 'name',
        header: 'Name',
        sortFn: 'text',
        filterFn: testTextFilter,
        enableGlobalFilter: true,
    },
    {
        accessorKey: 'status',
        header: 'Status',
        sortFn: 'text',
        filterFn: filterFn_equalsString,
        enableGlobalFilter: true,
    },
]
const testFilterConfigs = {
    name: { type: 'text', placeholder: 'Filter names…' },
    status: {
        type: 'select',
        placeholder: 'All statuses',
        options: [
            { label: 'Active', value: 'active' },
            { label: 'Disabled', value: 'disabled' },
        ],
    },
} as const satisfies TableColumnFilterConfigs

function TableHarness({
    data = testRows,
    isLoading = false,
}: {
    data?: Array<TestRow>
    isLoading?: boolean
}) {
    const [showFilters, setShowFilters] = useState(false)
    const { state, handler } = useClientTableLogic({
        data,
        columns: testColumns,
        getRowId: (row) => row.id,
        initialPageSize: 5,
    })

    return (
        <DataTable
            table={state.table}
            eyebrow="Test"
            title="Records"
            searchInput={state.searchInput}
            searchLabel="Search records"
            searchPlaceholder="Search records…"
            showColumnFilters={showFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={() => setShowFilters((visible) => !visible)}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={testFilterConfigs}
            isLoading={isLoading}
            loadingLabel="Loading records"
            emptyState={{ title: 'No records yet', description: 'Create a record.' }}
            filteredEmptyState={{
                title: 'No records match your filters',
                description: 'Reset the filters.',
            }}
            itemLabel="records"
        />
    )
}

describe('shared table preset', () => {
    test('sorts, filters, and resets through TanStack Table state', async () => {
        await render(<TableHarness />)
        expect(getDataRows()[0]?.textContent).toContain('Zulu')

        await click(getButton('Sort by name'))
        expect(getDataRows()[0]?.textContent).toContain('Alpha')

        await click(getButton('Filters'))
        await chooseSelectOption('All statuses', 'Disabled')
        expect(getDataRows().every((row) => row.textContent?.includes('disabled'))).toBeTrue()

        await click(getButton('Reset filters'))
        expect(document.body.textContent).toContain('of 12 records')
    })

    test('paginates, changes rows per page, and distinguishes filtered empty state', async () => {
        await render(<TableHarness />)
        expect(getDataRows()).toHaveLength(5)

        await chooseSelectOption('Rows per page', '10')
        expect(getDataRows()).toHaveLength(10)

        await click(getButton('Go to next page'))
        expect(getDataRows()).toHaveLength(2)
        expect(document.body.textContent).toContain('Page 2 of 2')

        const search = document.querySelector<HTMLInputElement>('input[type="search"]')
        expect(search).not.toBeNull()
        await setControlValue(search!, 'not-a-record')
        await waitFor(
            () => document.body.textContent?.includes('No records match your filters') ?? false,
        )
        expect(document.body.textContent).not.toContain('No records yet')
    })

    test('renders stable skeleton rows and an unfiltered empty state', async () => {
        await render(<TableHarness isLoading />)
        expect(document.querySelector('tbody[aria-busy="true"]')).not.toBeNull()
        expect(getDataRows()).toHaveLength(10)

        await act(async () => {
            activeRoot?.render(<TableHarness data={[]} />)
        })
        expect(document.body.textContent).toContain('No records yet')
    })
})

function DateRangeCalendarHarness() {
    const [value, setValue] = useState<DateRangeValue>({ from: '2026-01-10' })

    return (
        <>
            <DateRangeCalendar
                ariaLabel="Created range"
                value={value}
                onValueChange={(nextValue) => setValue(nextValue ?? {})}
            />
            <output>
                {value.from ? `${value.from} → ${value.to ?? 'open'}` : 'No date range'}
            </output>
        </>
    )
}

describe('shared date range calendar', () => {
    test('completes and clears a date range through the custom popover', async () => {
        await render(<DateRangeCalendarHarness />)

        await click(getButton('Created range: From 10 Jan 2026'))
        expect(document.body.textContent).toContain('January 2026')
        await click(getButton('Monday, 12 January 2026'))
        expect(document.body.textContent).toContain('2026-01-10 → 2026-01-12')

        await click(getButton('Created range: 10 Jan 2026 – 12 Jan 2026'))
        await click(getButton('Clear'))
        expect(document.body.textContent).toContain('No date range')
    })
})

function ConfirmHarness({
    isPending = false,
    onConfirm,
}: {
    readonly isPending?: boolean
    readonly onConfirm: () => void
}) {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open confirm
            </button>
            {open ? (
                <ConfirmDialog
                    open
                    onOpenChange={setOpen}
                    title="Delete record?"
                    description="This action cannot be undone."
                    confirmLabel="Delete record"
                    pendingLabel="Deleting record…"
                    destructive
                    isPending={isPending}
                    onConfirm={() => {
                        onConfirm()
                        setOpen(false)
                    }}
                />
            ) : null}
        </>
    )
}

describe('shared confirm dialog', () => {
    test('opens, cancels, returns focus, and closes on Escape', async () => {
        await render(<ConfirmHarness onConfirm={() => undefined} />)
        const opener = getButton('Open confirm')
        opener.focus()
        await click(opener)
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        await click(getButton('Cancel'))
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
        await waitFor(() => document.activeElement?.isSameNode(opener) ?? false)

        await click(opener)
        const dialog = document.querySelector('[role="dialog"]')
        expect(dialog).not.toBeNull()
        await act(async () => {
            dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
    })

    test('confirms once and blocks closing while pending', async () => {
        const onConfirm = mock(() => undefined)
        await render(<ConfirmHarness onConfirm={onConfirm} />)
        await click(getButton('Open confirm'))
        await click(getButton('Delete record'))
        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(document.querySelector('[role="dialog"]')).toBeNull()

        await act(async () => {
            activeRoot?.render(<ConfirmHarness isPending onConfirm={onConfirm} />)
        })
        await click(getButton('Open confirm'))
        const pendingButton = getButton('Deleting record…')
        expect(pendingButton.disabled).toBeTrue()
        const dialog = document.querySelector('[role="dialog"]')
        await act(async () => {
            dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    })
})

const user: UserSummary = {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Kevin Example',
    email: 'kevin@example.com',
    profileImageVersion: null,
    status: 'active',
    roleKeys: ['viewer'],
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
}
const customRole: RoleManagementSummary = {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'support',
    name: 'Support',
    description: 'Support access',
    isSystem: false,
    permissionKeys: [PERMISSIONS.APP_ACCESS],
    userCount: 0,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
}
const viewerRole: RoleManagementSummary = {
    ...customRole,
    id: '00000000-0000-4000-8000-000000000003',
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access',
    isSystem: true,
}

const usersTableProps = {
    actorIsOwner: true,
    canCreate: false,
    canDisable: false,
    canUpdate: false,
    createDisabled: false,
    currentUserId: '00000000-0000-4000-8000-000000000099',
    isLoading: false,
    onCreate: () => undefined,
    onDisable: () => undefined,
    onEdit: () => undefined,
}

const rolesTableProps = {
    canCreate: false,
    canDelete: false,
    canUpdate: false,
    isLoading: false,
    onCreate: () => undefined,
    onDelete: () => undefined,
    onEdit: () => undefined,
}

describe('localized management filters', () => {
    test('finds German status and system-role labels globally and keeps role values stable', async () => {
        await render(
            withTestLanguage(
                <TooltipProvider>
                    <UsersTable {...usersTableProps} users={[user]} />
                </TooltipProvider>,
                'de',
            ),
        )

        const search = document.querySelector<HTMLInputElement>('input[type="search"]')
        expect(search).not.toBeNull()
        expect(document.body.textContent).toContain('Aktiv')
        expect(document.body.textContent).toContain('Betrachter')

        await setControlValue(search!, 'Betrachter')
        await waitFor(() => getDataRows().length === 1)

        await setControlValue(search!, 'Aktiv')
        await waitFor(() => getDataRows().length === 1)

        await click(getButton('Filter'))
        await chooseSelectOption('Alle Rollen', 'Betrachter')
        expect(getDataRows()).toHaveLength(1)
    })

    test('finds localized German system-role name and description in role column filters', async () => {
        await render(
            withTestLanguage(<RolesTable {...rolesTableProps} roles={[viewerRole]} />, 'de'),
        )

        expect(document.body.textContent).toContain('Betrachter')
        expect(document.body.textContent).toContain('grundlegenden Anwendungs- und Kontozugriff')

        await click(getButton('Filter'))
        const nameFilter = document.querySelector<HTMLInputElement>(
            'input[aria-label="Name oder Schlüssel filtern…"]',
        )
        expect(nameFilter).not.toBeNull()
        await setControlValue(nameFilter!, 'Betrachter')
        await waitFor(() => getDataRows().length === 1)

        const descriptionFilter = document.querySelector<HTMLInputElement>(
            'input[aria-label="Beschreibungen filtern…"]',
        )
        expect(descriptionFilter).not.toBeNull()
        await setControlValue(descriptionFilter!, 'grundlegenden Anwendungs- und Kontozugriff')
        await waitFor(() => getDataRows().length === 1)
    })
})

describe('permission-aware row actions', () => {
    test('hides unavailable user actions and disables protected owner actions', async () => {
        await render(
            <UserTableActions
                user={user}
                actorIsOwner={false}
                canDisable={false}
                canUpdate={false}
                currentUserId="00000000-0000-4000-8000-000000000099"
                onDisable={() => undefined}
                onEdit={() => undefined}
            />,
        )
        expect(document.body.textContent).toContain('—')

        const ownerUser = { ...user, roleKeys: ['owner'] }
        await act(async () => {
            activeRoot?.render(
                <UserTableActions
                    user={ownerUser}
                    actorIsOwner={false}
                    canDisable
                    canUpdate
                    currentUserId="00000000-0000-4000-8000-000000000099"
                    onDisable={() => undefined}
                    onEdit={() => undefined}
                />,
            )
        })
        await openMenu(getButton('Open actions for Kevin Example'))
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        expect(items).toHaveLength(2)
        expect(items.every((item) => item.hasAttribute('data-disabled'))).toBeTrue()
    })

    test('disables the sensitive action for the current user', async () => {
        await render(
            <UserTableActions
                user={user}
                actorIsOwner={false}
                canDisable
                canUpdate={false}
                currentUserId={user.id}
                onDisable={() => undefined}
                onEdit={() => undefined}
            />,
        )

        await openMenu(getButton('Open actions for Kevin Example'))
        const disableItem = getMenuItem('Disable')
        expect(disableItem.hasAttribute('data-disabled')).toBeTrue()
        expect(disableItem.textContent).toContain('You cannot disable your own account.')
    })

    test('protects system roles and disables deletion while a custom role is assigned', async () => {
        await render(
            <RoleTableActions
                role={{ ...customRole, isSystem: true }}
                canDelete
                canUpdate
                onDelete={() => undefined}
                onEdit={() => undefined}
            />,
        )
        expect(document.body.textContent).toContain('Protected')

        await act(async () => {
            activeRoot?.render(
                <RoleTableActions
                    role={{ ...customRole, userCount: 2 }}
                    canDelete
                    canUpdate
                    onDelete={() => undefined}
                    onEdit={() => undefined}
                />,
            )
        })
        await openMenu(getButton('Open actions for Support'))
        const deleteItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
            (item) => item.textContent?.includes('Delete'),
        )
        expect(deleteItem?.hasAttribute('data-disabled')).toBeTrue()
        expect(deleteItem?.textContent).toContain('Assigned to 2 users.')
    })
})

function RoleDeleteHarness({ onDelete }: { readonly onDelete: () => void }) {
    const [deleteTarget, setDeleteTarget] = useState<RoleManagementSummary | null>(null)

    return (
        <>
            <RoleTableActions
                role={customRole}
                canDelete
                canUpdate
                onDelete={setDeleteTarget}
                onEdit={() => undefined}
            />
            {deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) {
                            setDeleteTarget(null)
                        }
                    }}
                    title="Delete role?"
                    description="This action cannot be undone."
                    confirmLabel="Delete role"
                    destructive
                    onConfirm={() => {
                        onDelete()
                        setDeleteTarget(null)
                    }}
                />
            ) : null}
        </>
    )
}

describe('role delete flow', () => {
    test('cancels without mutation and confirms through the shared dialog', async () => {
        const onDelete = mock(() => undefined)
        await render(<RoleDeleteHarness onDelete={onDelete} />)

        await openMenu(getButton('Open actions for Support'))
        await click(getMenuItem('Delete'))
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        await click(getButton('Cancel'))
        expect(onDelete).not.toHaveBeenCalled()

        await openMenu(getButton('Open actions for Support'))
        await click(getMenuItem('Delete'))
        await click(getButton('Delete role'))
        expect(onDelete).toHaveBeenCalledTimes(1)
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
})

function UserEditHarness({ canAssignRoles = false }: { readonly canAssignRoles?: boolean }) {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Edit user
            </button>
            {open ? (
                <UserFormModal
                    open
                    mode="edit"
                    user={user}
                    currentUserId="00000000-0000-4000-8000-000000000099"
                    canAssignRoles={canAssignRoles}
                    roles={canAssignRoles ? [viewerRole] : []}
                    onCurrentUserChanged={async () => undefined}
                    onOpenChange={setOpen}
                    onSuccess={() => setOpen(false)}
                />
            ) : null}
        </>
    )
}

describe('user form modal', () => {
    test('opens from edit, validates, and closes only after a successful mutation', async () => {
        await render(withQueryClient(<UserEditHarness />))
        await click(getButton('Edit user'))
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        const email = document.querySelector<HTMLInputElement>('input[name="email"]')
        expect(email).not.toBeNull()
        await setControlValue(email!, '')
        await click(getButton('Save changes'))
        await waitFor(() => document.body.textContent?.includes('This field is required.') ?? false)
        expect(updateUserHandlerMock).not.toHaveBeenCalled()
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        await setControlValue(email!, 'updated@example.com')
        await blurControl(email!)
        await click(getButton('Save changes'))
        await waitFor(() => updateUserHandlerMock.mock.calls.length === 1)
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
    })

    test('keeps values and the modal open after a server failure', async () => {
        updateUserHandlerMock.mockImplementationOnce(async () => ({
            success: false,
            message: 'This email address is already in use.',
        }))
        await render(withQueryClient(<UserEditHarness />))
        await click(getButton('Edit user'))
        const displayName = document.querySelector<HTMLInputElement>('input[name="displayName"]')
        expect(displayName).not.toBeNull()
        await setControlValue(displayName!, 'Changed Name')
        await click(getButton('Save changes'))
        await waitFor(() =>
            [...document.querySelectorAll<HTMLElement>('[data-toast-tone="error"]')].some(
                (toast) =>
                    toast.textContent?.includes('This email address is already in use.') ?? false,
            ),
        )
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
            'This email address is already in use.',
        )
        expect(displayName?.value).toBe('Changed Name')
        await waitFor(
            () =>
                document
                    .querySelector('[aria-live="assertive"]')
                    ?.textContent?.includes('This email address is already in use.') ?? false,
        )
        expect(
            document.querySelector('[aria-live="assertive"]')?.closest('[aria-hidden="true"]'),
        ).toBeNull()

        const closeToast = document.querySelector<HTMLButtonElement>(
            '[data-toast-tone="error"] button[aria-label="Dismiss notification"]',
        )!
        await act(async () => {
            closeToast.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
            )
        })
        await click(closeToast)
        await waitFor(() => document.querySelector('[data-toast-tone="error"]') === null)
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(displayName?.value).toBe('Changed Name')
    })

    test('invalidates role counts after a role-aware user update', async () => {
        await render(withQueryClient(<UserEditHarness canAssignRoles />))
        const invalidateQueries = spyOn(activeQueryClient!, 'invalidateQueries')

        await click(getButton('Edit user'))
        await click(getButton('Save changes'))
        await waitFor(() => updateUserHandlerMock.mock.calls.length === 1)
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: roleManagementQueryKeys.all })
    })
})

function RoleFormHarness({ mode }: { readonly mode: 'create' | 'edit' }) {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                {mode === 'create' ? 'Add role' : 'Edit role'}
            </button>
            {open ? (
                <RoleFormModal
                    open
                    mode={mode}
                    {...(mode === 'edit' ? { role: customRole } : {})}
                    currentUserRoleKeys={mode === 'edit' ? [customRole.key] : []}
                    canAssignPermissions
                    assignablePermissionKeys={PERMISSION_REGISTRY.map(
                        (permission) => permission.key,
                    )}
                    onCurrentUserChanged={async () => undefined}
                    onOpenChange={setOpen}
                    onSuccess={() => setOpen(false)}
                />
            ) : null}
        </>
    )
}

describe('role form modal', () => {
    test('creates a role from the grouped permission modal', async () => {
        await render(withQueryClient(<RoleFormHarness mode="create" />))
        await click(getButton('Add role'))
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(document.body.textContent).toContain('Application')
        expect(document.body.textContent).toContain('Users')
        expect(document.body.textContent).toContain('Roles')

        const keyInput = document.querySelector<HTMLInputElement>('input[name="key"]')
        const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]')
        expect(keyInput).not.toBeNull()
        expect(nameInput).not.toBeNull()
        await setControlValue(keyInput!, 'operations')
        await setControlValue(nameInput!, 'Operations')
        await click(getButton('Create role'))
        await waitFor(() => createRoleHandlerMock.mock.calls.length === 1)
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
    })

    test('opens and saves the edit modal with an immutable key', async () => {
        await render(withQueryClient(<RoleFormHarness mode="edit" />))
        await click(getButton('Edit role'))
        const keyInput = document.querySelector<HTMLInputElement>('input[name="key"]')
        expect(keyInput?.disabled).toBeTrue()
        expect(document.body.textContent).toContain('Edit Support')
        await click(getButton('Save changes'))
        await waitFor(() => updateRoleHandlerMock.mock.calls.length === 1)
        await waitFor(() => document.querySelector('[role="dialog"]') === null)
    })
})

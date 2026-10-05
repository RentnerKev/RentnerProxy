import { describe, expect, test } from 'bun:test'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
import { getRedirectHostTableActionItems } from '@/lib/Admin/RedirectHostManagement/redirectHostTableActions.ts'

const host: RedirectHostSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    domains: ['app.example.com'],
    destination: 'https://example.com',
    statusCode: 308,
    preserveRequestUri: true,
    enabled: true,
    certificateId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('Redirect Host table actions', () => {
    test('exposes edit, disable, and delete actions according to permissions', () => {
        const selected: string[] = []
        const items = getRedirectHostTableActionItems(
            {
                canUpdate: true,
                canDelete: true,
                canEnable: true,
                canDisable: true,
                isPending: false,
                host,
                onEdit: () => selected.push('edit'),
                onDelete: () => selected.push('delete'),
                onDisable: () => selected.push('disable'),
                onEnable: () => selected.push('enable'),
            },
            (key) => key,
        )
        expect(items.map(({ label }) => label)).toEqual([
            'admin.redirectHosts.actions.edit',
            'admin.redirectHosts.actions.disable',
            'admin.redirectHosts.actions.delete',
        ])
        items.forEach((item) => item.onSelect())
        expect(selected).toEqual(['edit', 'disable', 'delete'])
    })
})

describe('Redirect Host duplication action', () => {
    const props = {
        canUpdate: false,
        canDelete: false,
        canEnable: false,
        canDisable: false,
        isPending: false,
        host,
        onEdit: () => {},
        onDelete: () => {},
        onDisable: () => {},
        onEnable: () => {},
    }
    test('requires both a host permission predicate and duplicate handler', () => {
        expect(
            getRedirectHostTableActionItems({ ...props, canDuplicate: () => true }, (key) => key),
        ).toEqual([])
        expect(
            getRedirectHostTableActionItems({ ...props, onDuplicate: () => {} }, (key) => key),
        ).toEqual([])
        expect(
            getRedirectHostTableActionItems(
                { ...props, canDuplicate: () => false, onDuplicate: () => {} },
                (key) => key,
            ),
        ).toEqual([])
    })
    test('passes the source to duplication and disables the action while pending', () => {
        const selected: RedirectHostSummary[] = []
        const items = getRedirectHostTableActionItems(
            {
                ...props,
                isPending: true,
                canDuplicate: (candidate) => candidate === host,
                onDuplicate: (candidate) => selected.push(candidate),
            },
            (key) => key,
        )
        expect(items).toHaveLength(1)
        expect(items[0]?.label).toBe('admin.redirectHosts.actions.duplicate')
        expect(items[0]?.disabled).toBeTrue()
        items[0]?.onSelect()
        expect(selected).toEqual([host])
    })
})

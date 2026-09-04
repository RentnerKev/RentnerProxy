import { describe, expect, test } from 'bun:test'
import type { RedirectHostSummary } from '../shared/Types/redirect-hosts.types'
import { getRedirectHostTableActionItems } from '../features/Admin/RedirectHostManagement/Helpers/redirectHostTableActions'

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

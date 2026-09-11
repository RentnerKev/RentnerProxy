import { describe, expect, test } from 'bun:test'

import { getAccessPolicyTableActionItems } from '../features/Admin/AccessPolicyManagement/Helpers/accessPolicyTableActions'
import type { AccessPolicySummary } from '../shared/Types/access-policies.types'

const policy: AccessPolicySummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
    name: 'Office access',
    description: '',
    mode: 'combined',
    combination: 'all',
    assignedHostCount: 0,
    basicAuthAccountCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('Access Policy table actions', () => {
    test('exposes edit and delete actions for an unassigned policy', () => {
        const selected: string[] = []
        const items = getAccessPolicyTableActionItems(
            {
                canUpdate: true,
                canDelete: true,
                isPending: false,
                policy,
                onEdit: () => selected.push('edit'),
                onDelete: () => selected.push('delete'),
            },
            (key) => key,
        )

        expect(items.map(({ label }) => label)).toEqual([
            'admin.accessPolicies.actions.edit',
            'admin.accessPolicies.actions.delete',
        ])
        expect(items[1]?.disabled).toBe(false)
        items.forEach((item) => item.onSelect())
        expect(selected).toEqual(['edit', 'delete'])
    })

    test('disables deletion while a policy is assigned to hosts', () => {
        const assignedPolicy = { ...policy, assignedHostCount: 2 }
        const items = getAccessPolicyTableActionItems(
            {
                canUpdate: false,
                canDelete: true,
                isPending: false,
                policy: assignedPolicy,
                onEdit: () => undefined,
                onDelete: () => undefined,
            },
            (key) => key,
        )

        expect(items).toHaveLength(1)
        expect(items[0]?.disabled).toBe(true)
        expect(items[0]?.description).toBe('admin.accessPolicies.actions.deleteAssigned')
    })
})

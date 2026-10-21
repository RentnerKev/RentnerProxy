import { describe, expect, test } from 'bun:test'
import { HOST_TAG_LIMITS } from '@/config/host-tags.config.ts'
import {
    assignHostTags,
    emptyHostTagState,
    hostTagNameSchema,
    hostTagStateSchema,
    mutateHostTags,
    tagsForHost,
} from '@/lib/HostTags/hostTags.ts'
import { hostListQuerySchema, hostTagMutationSchema } from '@/features/Admin/HostTags/validation.ts'
import { getProxyHostFormValues } from '@/lib/Admin/ProxyHostManagement/proxyHostFormValues.ts'
import { getRedirectHostFormDefaultValues } from '@/lib/Admin/RedirectHostManagement/redirectHostFormValues.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'

const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
const hostId = '00000000-0000-4000-8000-000000000003'
const kind = 'proxy' as const

describe('host classification', () => {
    test('normalizes Unicode, case and whitespace for names and rejects empty, control and excessive input', () => {
        expect(hostTagNameSchema.parse('  Ｉnfra   Büro  ')).toBe('Infra Büro')
        for (const invalid of [
            '',
            '   ',
            'x'.repeat(65),
            'hidden\u200b',
            'line\nbreak',
            '\u0000',
        ]) {
            expect(hostTagNameSchema.safeParse(invalid).success).toBe(false)
        }
        const state = mutateHostTags(
            emptyHostTagState(),
            { kind, action: 'create', name: 'Infra Büro', expectedRevision: 0 },
            first,
        )
        expect(() =>
            mutateHostTags(
                state,
                { kind, action: 'create', name: '  infra büro ', expectedRevision: 1 },
                second,
            ),
        ).toThrow('admin.hostTags.errors.duplicate')
    })
    test('supports several tags, preserves assignment IDs on rename and removes only a deleted tag', () => {
        let state = mutateHostTags(
            emptyHostTagState(),
            { kind, action: 'create', name: 'Infra', expectedRevision: 0 },
            first,
        )
        state = mutateHostTags(
            state,
            { kind, action: 'create', name: 'Privat', expectedRevision: 1 },
            second,
        )
        state = assignHostTags(state, hostId, [second, first])
        const renamed = mutateHostTags(
            state,
            {
                kind,
                action: 'rename',
                tagId: first,
                name: 'Büro',
                expectedRevision: state.revision,
            },
            second,
        )
        expect(renamed.assignments[hostId]).toEqual(state.assignments[hostId])
        expect(tagsForHost(renamed, hostId).map((tag) => tag.name)).toEqual(['Büro', 'Privat'])
        const deleted = mutateHostTags(
            renamed,
            { kind, action: 'delete', tagId: first, expectedRevision: renamed.revision },
            second,
        )
        expect(deleted.assignments[hostId]).toEqual([second])
        expect(tagsForHost(deleted, '00000000-0000-4000-8000-000000000004')).toEqual([])
        const cleared = assignHostTags(deleted, hostId, [])
        expect(cleared.assignments).toEqual({})
        expect(assignHostTags(cleared, hostId, [])).toBe(cleared)
    })
    test('rejects missing tags, duplicate IDs, stale writes, stale assignments and tag exhaustion', () => {
        const state = mutateHostTags(
            emptyHostTagState(),
            { kind, action: 'create', name: 'Infra', expectedRevision: 0 },
            first,
        )
        expect(() => assignHostTags(state, hostId, [second])).toThrow(
            'admin.hostTags.errors.missing',
        )
        expect(() => assignHostTags(state, hostId, [first, first])).toThrow()
        expect(() =>
            mutateHostTags(
                state,
                { kind, action: 'delete', tagId: first, expectedRevision: 0 },
                second,
            ),
        ).toThrow('admin.hostTags.errors.conflict')
        expect(() =>
            mutateHostTags(
                state,
                {
                    kind,
                    action: 'assign',
                    hostId,
                    tagIds: [first],
                    expectedTagIds: [first],
                    expectedRevision: 1,
                },
                second,
            ),
        ).toThrow('admin.hostTags.errors.conflict')
        expect(() =>
            mutateHostTags(
                state,
                { kind, action: 'rename', tagId: second, name: 'X', expectedRevision: 1 },
                second,
            ),
        ).toThrow('admin.hostTags.errors.missing')
        const full = {
            ...state,
            tags: Array.from({ length: HOST_TAG_LIMITS.tags }, (_, index) => ({
                id: crypto.randomUUID(),
                name: 'Tag ' + index,
            })),
        }
        expect(() =>
            mutateHostTags(
                full,
                { kind, action: 'create', name: 'Extra', expectedRevision: 1 },
                first,
            ),
        ).toThrow('admin.hostTags.errors.limit')
    })
    test('round-trips backup metadata and rejects corrupt restored references instead of silently discarding them', () => {
        const oldBackup = emptyHostTagState()
        expect(oldBackup.tags).toEqual([])
        expect(oldBackup.assignments).toEqual({})
        const tagged = assignHostTags(
            mutateHostTags(
                oldBackup,
                { kind, action: 'create', name: 'Infra', expectedRevision: 0 },
                first,
            ),
            hostId,
            [first],
        )
        expect(hostTagStateSchema.parse(JSON.parse(JSON.stringify(tagged)))).toEqual(tagged)
        expect(hostTagStateSchema.safeParse({ ...tagged, tags: [] }).success).toBe(false)
        expect(hostTagStateSchema.safeParse({ ...tagged, version: 2 }).success).toBe(false)
    })
    test('bounds and validates public list and assignment contracts', () => {
        for (const query of [
            { pageSize: 101 },
            { pageIndex: -1 },
            { sorting: [{ id: 'private', desc: false }] },
            { filters: [{ id: 'createdAt', value: { from: 'yesterday' } }] },
        ]) {
            expect(hostListQuerySchema.safeParse(query).success).toBe(false)
        }
        expect(
            hostTagMutationSchema.safeParse({
                kind,
                action: 'assign',
                hostId,
                tagIds: [first],
                expectedTagIds: [],
                expectedRevision: 0,
            }).success,
        ).toBe(true)
        expect(
            hostTagMutationSchema.safeParse({
                kind: 'admin',
                action: 'create',
                name: 'X',
                expectedRevision: 0,
            }).success,
        ).toBe(false)
    })
    test('duplicates both host types with independent tag arrays and preserves ordinary blank domains', () => {
        const tags = [{ id: first, name: 'Infra' }]
        const proxy: ProxyHostSummary = {
            id: hostId,
            domains: ['app.example.com'],
            tags,
            forwardScheme: 'http',
            forwardHost: 'internal',
            forwardPort: 80,
            enabled: true,
            certificateId: null,
            forceHttps: false,
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        const redirect: RedirectHostSummary = {
            id: hostId,
            domains: ['redirect.example.com'],
            tags,
            destination: 'https://example.com',
            statusCode: 302,
            preserveRequestUri: true,
            enabled: true,
            certificateId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        const proxyDraft = getProxyHostFormValues('duplicate', proxy)
        const redirectDraft = getRedirectHostFormDefaultValues('duplicate', redirect)
        expect(proxyDraft.tagIds).toEqual([first])
        expect(redirectDraft.tagIds).toEqual([first])
        proxyDraft.tagIds!.push(second)
        redirectDraft.tagIds!.splice(0)
        expect(tags).toEqual([{ id: first, name: 'Infra' }])
        expect(proxyDraft.domains).toEqual([''])
        expect(redirectDraft.domains).toEqual([''])
        expect(getProxyHostFormValues('create', proxy).tagIds).toBeUndefined()
        expect(getRedirectHostFormDefaultValues('create', redirect).tagIds).toBeUndefined()
    })
})

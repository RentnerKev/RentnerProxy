import { describe, expect, test } from 'bun:test'

import type { CertificateJobStage } from '../config/certificate-jobs.config'
import { getProxyHostTableActionItems } from '../features/Admin/ProxyHostManagement/Helpers/proxyHostTableActions'
import type { ProxyHostTableActionsProps } from '../features/Admin/ProxyHostManagement/Types/proxy-host-table.types'
import type { ProxyHostSummary } from '../shared/Types/proxy-hosts.types'

const host: ProxyHostSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    domains: ['app.example.com'],
    forwardScheme: 'http',
    forwardHost: 'upstream.internal',
    forwardPort: 8080,
    enabled: true,
    certificateId: null,
    forceHttps: false,
    verifyUpstreamTls: false,
    upstreamTlsServerName: null,
    trustedCaId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function actionFor(
    stage: CertificateJobStage | null,
    options: { readonly hasError?: boolean; readonly isPending?: boolean } = {},
) {
    const selected: string[] = []
    const actionHost: ProxyHostSummary = {
        ...host,
        certificateJob:
            stage === null
                ? null
                : {
                      id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
                      proxyHostId: host.id,
                      certificateId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
                      domains: host.domains,
                      stage,
                      controllerStage: null,
                      lastErrorCode: options.hasError ? 'controller_unavailable' : null,
                      createdAt: new Date('2026-01-01T00:00:00Z'),
                      updatedAt: new Date('2026-01-01T00:00:00Z'),
                  },
    }
    const props: ProxyHostTableActionsProps = {
        canUpdate: true,
        canDelete: false,
        canEnable: false,
        canDisable: false,
        canRequestCertificate: true,
        isPending: options.isPending ?? false,
        host: actionHost,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onDisable: () => undefined,
        onEnable: () => undefined,
        onRequestCertificate: (selectedHost) => selected.push(selectedHost.id),
    }
    const items = getProxyHostTableActionItems(props, (key) => key)
    const action = items.find(({ label }) => label.startsWith('admin.certificates.actions.'))
    if (!action) throw new Error('Certificate action unavailable.')
    return { action, selected }
}

describe('Proxy Host certificate table action', () => {
    test('allows a request when there is no job or the previous job was applied', () => {
        for (const stage of [null, 'applied'] as const) {
            const { action, selected } = actionFor(stage)
            expect(action.label).toBe('admin.certificates.actions.requestForHost')
            expect(action.disabled).toBe(false)
            action.onSelect()
            expect(selected).toEqual([host.id])
        }
    })

    test('blocks clean active jobs while keeping failed work retryable', () => {
        for (const stage of ['preparing', 'issuing', 'applying'] as const) {
            const active = actionFor(stage).action
            expect(active.label).toBe('admin.certificates.actions.requestForHost')
            expect(active.disabled).toBe(true)

            const retry = actionFor(stage, { hasError: true }).action
            expect(retry.label).toBe('admin.certificates.actions.retry')
            expect(retry.disabled).toBe(false)
        }

        for (const stage of ['failed', 'needs_attention'] as const) {
            const retry = actionFor(stage).action
            expect(retry.label).toBe('admin.certificates.actions.retry')
            expect(retry.disabled).toBe(false)
        }
    })

    test('keeps the action disabled while another host action is pending', () => {
        expect(actionFor('applied', { isPending: true }).action.disabled).toBe(true)
        expect(actionFor('failed', { isPending: true }).action.disabled).toBe(true)
    })
})

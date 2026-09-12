import { describe, expect, test } from 'bun:test'

import { smokeProgress } from '../../../scripts/production-smoke-ci'
import {
    SMOKE_RUN_LABEL,
    restoreSmokeDiagnostic,
    smokeCompose,
    smokeDockerArguments,
    smokeRunScope,
} from '../../../scripts/smoke-resources'

describe('production smoke CI output boundary', () => {
    test('keeps restore phases and upgrade locations without forwarding raw errors', () => {
        const raw =
            'Production restore failed: production restore operation failed: restore PostgreSQL. No automatic destructive retry was attempted.\nprivate-value'
        const diagnostic = restoreSmokeDiagnostic(raw)
        expect(diagnostic).toBe('Restore failed: restore PostgreSQL')
        expect(
            restoreSmokeDiagnostic('production restore operation failed: private-value.'),
        ).toBeUndefined()
        const progress = smokeProgress('production')
        progress.consume(diagnostic!)
        progress.consume('at scripts/alpha1-upgrade-smoke.ts:264:20')
        progress.consume('Restore failed: private-value')
        progress.consume('at scripts/private-value.ts:1:1')
        expect(progress.result(1).diagnostic).toBe(
            'Restore failed: restore PostgreSQL at scripts/alpha1-upgrade-smoke.ts:264:20',
        )
    })

    test('requires a successful process and matching observed completion counts', () => {
        const progress = smokeProgress('proxy')
        expect(progress.consume('PASS forwarding headers')).toBe('Proxy runtime: check 1 passed')
        expect(progress.result(0).passed).toBe(false)
        progress.consume('Real Caddy proxy integration: 2 checks passed.')
        expect(progress.result(0).passed).toBe(false)
        progress.consume('PASS WebSocket upgrade')
        expect(progress.result(0).passed).toBe(true)
        expect(progress.result(1).passed).toBe(false)
    })

    test('does not accept empty output or another suite completion', () => {
        const progress = smokeProgress('production')
        expect(progress.result(0).passed).toBe(false)
        progress.consume('PASS appliance readiness')
        progress.consume('Real Caddy proxy integration: 1 checks passed.')
        expect(progress.result(0).passed).toBe(false)
        progress.consume('Appliance Compose smoke passed: 1 assertions')
        expect(progress.result(0).passed).toBe(true)
    })

    test('discards credential, PEM, assertion operand and workflow command output', () => {
        const progress = smokeProgress('certificates')
        for (const line of [
            'DATABASE_URL=postgresql://fixture:private-value@localhost/test',
            'APP_ENCRYPTION_KEY=private-value',
            'RENTNERPROXY_CONTROLLER_TOKEN=private-value',
            '-----BEGIN PRIVATE KEY-----',
            'private-value',
            '-----END PRIVATE KEY-----',
            'AssertionError: private-value should not be printed',
            'Expected: private-value',
            'Received: private-value',
            '::warning::private-value',
            '::add-mask::private-value',
        ]) {
            expect(progress.consume(line)).toBeUndefined()
        }
        expect(progress.consume('PASS private-value')).toBe('Certificates / ACME: check 1 passed')
        expect(JSON.stringify(progress.result(1))).not.toContain('private-value')
        expect(progress.result(1).diagnostic).toBe('Smoke assertion failed')
    })

    test('retains useful failure categories and only the selected source location', () => {
        const progress = smokeProgress('upstream-tls')
        progress.consume('error: Smoke command failed: docker exec private-value')
        progress.consume('    at runSmoke (/workspace/scripts/upstream-tls-smoke.ts:372:15)')
        progress.consume('    at other (/private/scripts/another-file.ts:10:12)')
        expect(progress.result(1).diagnostic).toBe(
            'Docker exec failed at scripts/upstream-tls-smoke.ts:372:15',
        )
        progress.consume('error: Timed out waiting for private-value')
        expect(progress.result(1).diagnostic).toBe('Readiness polling timed out')
    })

    test('retains allowlisted certificate errors without printing unknown diagnostics', () => {
        const progress = smokeProgress('certificates')
        progress.consume('error: Certificate operation failed: acme_failed')
        expect(progress.result(1).diagnostic).toBe('Certificate operation failed: acme_failed')
        progress.consume('error: Certificate operation failed: private-value')
        expect(progress.result(1).diagnostic).toBe('Certificate operation failed: acme_failed')
        progress.consume('error: Certificate operation failed: dns_cleanup_failed')
        expect(progress.result(1).diagnostic).toBe(
            'Certificate operation failed: dns_cleanup_failed',
        )
    })
})

function inScope<T>(scope: string | undefined, operation: () => T): T {
    const previous = process.env.RENTNERPROXY_SMOKE_RUN
    if (scope === undefined) delete process.env.RENTNERPROXY_SMOKE_RUN
    else process.env.RENTNERPROXY_SMOKE_RUN = scope
    try {
        return operation()
    } finally {
        if (previous === undefined) delete process.env.RENTNERPROXY_SMOKE_RUN
        else process.env.RENTNERPROXY_SMOKE_RUN = previous
    }
}

describe('production smoke resource ownership', () => {
    test('rejects branch names, paths and shell fragments before creating resources', () => {
        for (const scope of ['main', '../../state', '12-1;docker', '12-1\n', '--all', '']) {
            inScope(scope, () => {
                if (scope === '') expect(smokeRunScope()).toBeUndefined()
                else expect(() => smokeRunScope()).toThrow('invalid smoke resource scope')
            })
        }
        inScope('123456-2', () => expect(smokeRunScope()).toBe('123456-2'))
        inScope('local-123456abcdef', () => expect(smokeRunScope()).toBe('local-123456abcdef'))
    })

    test('labels owned creation commands without rewriting payloads or unrelated commands', () => {
        inScope('123456-2', () => {
            const label = SMOKE_RUN_LABEL + '=123456-2'
            expect(
                smokeDockerArguments(['docker', 'run', '--rm', 'fixture', 'echo', '--label']),
            ).toEqual(['docker', 'run', '--label', label, '--rm', 'fixture', 'echo', '--label'])
            expect(smokeDockerArguments(['docker', 'network', 'create', 'fixture'])).toEqual([
                'docker',
                'network',
                'create',
                '--label',
                label,
                'fixture',
            ])
            expect(smokeDockerArguments(['docker', 'volume', 'create', 'fixture'])).toEqual([
                'docker',
                'volume',
                'create',
                '--label',
                label,
                'fixture',
            ])
            for (const args of [
                ['docker', 'exec', 'fixture', 'echo', 'value'],
                ['docker', 'compose', 'up', '--detach'],
                ['docker', 'rm', '--force', 'fixture'],
                ['bun', 'scripts/production-restore.ts'],
            ])
                expect(smokeDockerArguments(args)).toEqual(args)
        })
        inScope(undefined, () => {
            expect(smokeDockerArguments(['docker', 'run', 'fixture'])).toEqual([
                'docker',
                'run',
                'fixture',
            ])
        })
    })

    test('labels Compose helper containers, image builds, empty volume declarations and networks', () => {
        const source = `services:
    fixture:
        image: fixture:local
        build:
            context: .
        labels:
            - existing=kept
        volumes:
            - state:/data
volumes:
    state:
`
        inScope('123456-2', () => {
            const compose = JSON.parse(smokeCompose(source))
            expect(compose.services.fixture.image).toBe('fixture:local')
            expect(compose.services.fixture.labels).toEqual({
                existing: 'kept',
                [SMOKE_RUN_LABEL]: '123456-2',
            })
            expect(compose.services.fixture.build.labels[SMOKE_RUN_LABEL]).toBe('123456-2')
            expect(compose.volumes.state.labels[SMOKE_RUN_LABEL]).toBe('123456-2')
            expect(compose.networks.default.labels[SMOKE_RUN_LABEL]).toBe('123456-2')
        })
        inScope(undefined, () => expect(smokeCompose(source)).toBe(source))
    })
})

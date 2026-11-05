import { describe, expect, test } from 'bun:test'
import {
    managedBackupSmokeCompose,
    validateManagedBackupTestImage,
    managedRestoreDiagnostic,
} from '../../../../.github/scripts/ci/managed-backups-smoke.ts'
import { backupNotificationPayloadSchema } from '../../../../.github/scripts/ci/fixtures/managed-backup-probe.ts'
import { SMOKE_RUN_LABEL, smokeRunScope } from '../../../../scripts/smoke/resources.ts'
import {
    onlineRestoreFailureDiagnostic,
    isOnlineRestoreDiagnostic,
    RESTORE_CHECKPOINTS,
} from '../../../../.github/scripts/ci/online-restore-diagnostics.ts'
import { waitForRestoreCheckpoint } from '../../../../.github/scripts/ci/fixtures/managed-restore-probe.ts'
import { smokeProgress } from '../../../../.github/scripts/ci/production-smoke-ci.ts'

test.each(RESTORE_CHECKPOINTS)(
    'every declared checkpoint passes both diagnostic boundaries: %s',
    (phase) => {
        const assertion = new Error('synthetic-private-value')
        assertion.name = 'AssertionError'
        for (const [error, category] of [
            [assertion, 'assertion'],
            [new DOMException('synthetic-private-value', 'TimeoutError'), 'timeout'],
            [new Error('synthetic-private-value'), 'other'],
        ] as const) {
            const line = `Managed online restore checkpoint: ${phase} category=${category}`
            expect(onlineRestoreFailureDiagnostic(phase, error)).toBe(line)
            expect(managedRestoreDiagnostic(line)).toBe(line)
            expect(smokeProgress('backups').consume(line)).toBe(line)
        }
    },
)

test('an actual restore checkpoint deadline is classified as a sanitized timeout', async () => {
    let failure: unknown
    try {
        await waitForRestoreCheckpoint(async () => undefined, 1)
    } catch (error) {
        failure = error
    }
    expect(failure).toBeInstanceOf(DOMException)
    const line = onlineRestoreFailureDiagnostic('progress', failure)
    expect(line).toBe('Managed online restore checkpoint: progress category=timeout')
    expect(smokeProgress('backups').consume(managedRestoreDiagnostic(line)!)).toBe(line)
})

test('online restore diagnostics expose only fixed checkpoints and exception categories', () => {
    const secret = 'synthetic-private-session-and-SQL'
    const assertion = new Error(secret)
    assertion.name = 'AssertionError'
    const cases = [
        [assertion, 'assertion'],
        [new DOMException(secret, 'TimeoutError'), 'timeout'],
        [new DOMException(secret, 'AbortError'), 'timeout'],
        [new Error(secret), 'other'],
        [{ message: secret, actual: secret, expected: secret }, 'other'],
    ] as const
    for (const [error, category] of cases) {
        const line = onlineRestoreFailureDiagnostic('restore-start', error)
        expect(line).toBe(`Managed online restore checkpoint: restore-start category=${category}`)
        expect(isOnlineRestoreDiagnostic(line)).toBeTrue()
        expect(managedRestoreDiagnostic(`${secret}\n${line}\n${secret}`)).toBe(line)
        for (const unsafe of [
            `prefix ${line}`,
            `${line} ${secret}`,
            line.replace('restore-start', secret),
            line.replace(`category=${category}`, `category=${secret}`),
            `${line}\n${secret}`,
            `${line}\n`,
        ]) {
            expect(isOnlineRestoreDiagnostic(unsafe)).toBeFalse()
        }
        expect(managedRestoreDiagnostic(`${line} ${secret}`)).toBeUndefined()
        expect(line).not.toContain(secret)
    }
    const first = onlineRestoreFailureDiagnostic('progress', assertion)
    const second = onlineRestoreFailureDiagnostic('completion-api', assertion)
    expect(managedRestoreDiagnostic(`${first}\r\n${second}`)).toBe(first)
})

describe('managed backup isolated smoke configuration', () => {
    test('accepts explicit repository tags and content-addressed image references', () => {
        for (const image of [
            'rentnerproxy-issue290:work',
            'ghcr.io/rentnerkev/rentnerproxy:managed-backups',
            'localhost:5000/team/image:fixture',
            'image@sha256:' + 'a'.repeat(64),
        ])
            expect(validateManagedBackupTestImage(image)).toBe(image)
    })

    test('rejects image references that could become options, shell text, or uncontrolled input', () => {
        for (const image of [
            '',
            '--privileged',
            'image;command',
            'image\nnext',
            'registry/image latest',
            'https://registry/image',
            'image@sha256:bad',
            'x'.repeat(256),
        ])
            expect(() => validateManagedBackupTestImage(image)).toThrow(
                'Invalid managed backup test image reference',
            )
    })

    test('uses project-scoped labeled state without host ports, host mounts, or external connectivity', () => {
        const scope = smokeRunScope() ?? 'local-0123456789ab'
        const document = JSON.parse(managedBackupSmokeCompose('fixture-image:test', scope)) as {
            services: {
                rentnerproxy: {
                    ports?: unknown
                    volumes: string[]
                    labels: Record<string, string>
                    environment: Record<string, string>
                    restart: string
                }
            }
            volumes: { data: { external?: boolean; name?: string; labels: Record<string, string> } }
            networks: {
                default: { internal: boolean; external?: boolean; labels: Record<string, string> }
            }
        }
        const service = document.services.rentnerproxy
        expect(service.ports).toBeUndefined()
        expect(service.volumes).toEqual(['data:/var/lib/rentnerproxy'])
        expect(service.restart).toBe('no')
        expect(service.environment.PUBLIC_ORIGIN).toBe('https://managed-backup.invalid')
        expect(service.labels[SMOKE_RUN_LABEL]).toBe(scope)
        expect(document.volumes.data.labels[SMOKE_RUN_LABEL]).toBe(scope)
        expect(document.volumes.data.name).toBeUndefined()
        expect(document.volumes.data.external).toBeUndefined()
        expect(document.networks.default.internal).toBe(true)
        expect(document.networks.default.external).toBeUndefined()
        expect(document.networks.default.labels[SMOKE_RUN_LABEL]).toBe(scope)
    })
})

describe('backup notification smoke receiver contract', () => {
    const payload = {
        schemaVersion: 1,
        id: '00000000-0000-4000-8000-000000000001',
        incidentId: '00000000-0000-4000-8000-000000000002',
        type: 'success',
        category: 'backup',
        severity: 'info',
        resourceId: '00000000-0000-4000-8000-000000000003',
        code: 'backup_succeeded',
        occurredAt: '2026-10-31T00:00:00.000Z',
        startedAt: '2026-10-31T00:00:00.000Z',
        failures: 0,
    }
    test('accepts the success and failure wire payloads used by the private receiver', () => {
        expect(backupNotificationPayloadSchema.safeParse(payload).success).toBe(true)
        expect(
            backupNotificationPayloadSchema.safeParse({
                ...payload,
                type: 'incident',
                severity: 'error',
                failures: 1,
                code: 'backup_failed',
            }).success,
        ).toBe(true)
    })
    test('rejects mixed outcome semantics and incidental sensitive fields', () => {
        expect(
            backupNotificationPayloadSchema.safeParse({ ...payload, code: 'backup_failed' })
                .success,
        ).toBe(false)
        expect(
            backupNotificationPayloadSchema.safeParse({ ...payload, filePath: '/private/backup' })
                .success,
        ).toBe(false)
        expect(
            backupNotificationPayloadSchema.safeParse({
                ...payload,
                authorization: 'synthetic-fixture-only',
            }).success,
        ).toBe(false)
    })
})

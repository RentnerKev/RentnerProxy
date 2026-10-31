import { describe, expect, test } from 'bun:test'
import {
    managedBackupSmokeCompose,
    validateManagedBackupTestImage,
} from '../../../../.github/scripts/ci/managed-backups-smoke.ts'
import { SMOKE_RUN_LABEL, smokeRunScope } from '../../../../scripts/smoke/resources.ts'

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

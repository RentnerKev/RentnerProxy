// oxlint-disable no-await-in-loop -- Remove only this consumer's images in order.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { sharedSmokeImage, verifySharedSmokeImage } from '../../../../scripts/smoke/images.ts'
import type { ApplianceCommand } from '../fixtures/Types/appliance-storage.types.ts'
import { immutableImageId } from './source-identity.ts'

export function createCompatibilityImages(runId: string, needsHttp3: boolean) {
    const sharedTarget = sharedSmokeImage('appliance')
    const sharedClient = needsHttp3 ? sharedSmokeImage('http3-client') : undefined
    const targetImage = sharedTarget ?? `rentnerproxy:compat-${runId}`
    const http3Image = sharedClient ?? `rentnerproxy:compat-http3-${runId}`
    const ownedImages = [
        ...(sharedTarget ? [] : [targetImage]),
        ...(needsHttp3 && !sharedClient ? [http3Image] : []),
    ]
    return {
        targetImage,
        http3Image,
        async prepareTarget(
            command: ApplianceCommand,
            source: { readonly revision: string; readonly context: string },
        ): Promise<string> {
            if (sharedTarget) {
                await verifySharedSmokeImage(
                    (args, options) => command(args, options?.timeoutMs),
                    'appliance',
                )
                const revision = await command([
                    'docker',
                    'image',
                    'inspect',
                    '--format',
                    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                    targetImage,
                ])
                assert.equal(
                    revision,
                    source.revision,
                    'Prebuilt image must identify the target revision',
                )
            } else {
                await command(
                    [
                        'docker',
                        'build',
                        '--file',
                        join(source.context, 'docker/production/Dockerfile'),
                        '--tag',
                        targetImage,
                        '--label',
                        `org.opencontainers.image.revision=${source.revision}`,
                        source.context,
                    ],
                    1_800_000,
                )
            }
            return immutableImageId(
                await command(['docker', 'image', 'inspect', '--format', '{{.Id}}', targetImage]),
            )
        },
        async cleanup(command: ApplianceCommand): Promise<void> {
            for (const image of ownedImages)
                await command(['docker', 'image', 'rm', image], 180_000).catch(() => undefined)
        },
    }
}

import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackupAgentServer } from '../../../../../../docker/production/backups/agent.ts'

test.skipIf(process.platform !== 'linux')(
    'production Unix listener survives silent preparation beyond the default ten-second idle cutoff',
    async () => {
        const root = await mkdtemp(join(tmpdir(), 'rentnerproxy-agent-transport-'))
        const socket = join(root, 'agent.sock')
        const server = createBackupAgentServer(socket, async () => {
            await Bun.sleep(18_000)
            return new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new Uint8Array(1024).fill(42))
                        controller.close()
                    },
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-tar',
                        'X-Rentnerproxy-Backup-Bytes': '1024',
                    },
                },
            )
        })
        try {
            const response = await fetch(
                'http://localhost/artifacts/00000000-0000-4000-8000-000000000001/download',
                {
                    unix: socket,
                    headers: { Connection: 'close' },
                    signal: AbortSignal.timeout(23_000),
                },
            )
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('application/x-tar')
            expect(response.headers.get('x-rentnerproxy-backup-bytes')).toBe('1024')
            expect(new Uint8Array(await response.arrayBuffer())).toEqual(
                new Uint8Array(1024).fill(42),
            )
        } finally {
            await server.stop(true)
            await rm(root, { recursive: true, force: true })
        }
    },
    25_000,
)

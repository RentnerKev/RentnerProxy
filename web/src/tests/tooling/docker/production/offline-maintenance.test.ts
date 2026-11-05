// oxlint-disable no-await-in-loop -- Verify malformed proof records against one private fixture file.
import { expect, test } from 'bun:test'
import { chmod, chown, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readIsolatedValidationProof } from '../../../../../../docker/production/backups/maintenance.ts'

test.skipIf(process.getuid?.() !== 0)(
    'offline restore accepts only a bounded root-owned isolated-validation proof',
    async () => {
        const root = await mkdtemp(join(tmpdir(), 'rp-validation-proof-')),
            path = join(root, 'proof.json'),
            backupId = 'a'.repeat(64)
        try {
            await writeFile(path, JSON.stringify({ schemaVersion: 1, backupId }), { mode: 0o600 })
            expect(await readIsolatedValidationProof(path)).toBe(backupId)
            await chmod(path, 0o666)
            await expect(readIsolatedValidationProof(path)).rejects.toThrow('Invalid isolated')
            await chmod(path, 0o600)
            await chown(path, 1, 1)
            await expect(readIsolatedValidationProof(path)).rejects.toThrow('Invalid isolated')
            await chown(path, 0, 0)
            for (const value of [
                null,
                [],
                { schemaVersion: 2, backupId },
                { schemaVersion: 1, backupId: 'bad' },
            ]) {
                await writeFile(path, JSON.stringify(value))
                await expect(readIsolatedValidationProof(path)).rejects.toThrow('Invalid isolated')
            }
            await writeFile(path, ' '.repeat(257))
            await expect(readIsolatedValidationProof(path)).rejects.toThrow('Invalid isolated')
            await rm(path)
            await mkdir(path)
            await expect(readIsolatedValidationProof(path)).rejects.toThrow('Invalid isolated')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    },
)

test.skipIf(process.platform !== 'linux')(
    'backup metadata FIFOs are rejected without waiting for a writer',
    async () => {
        const root = await mkdtemp(join(tmpdir(), 'rp-backup-fifo-')),
            snapshot = join(root, 'snapshot')
        try {
            await mkdir(snapshot)
            const fifo = Bun.spawnSync(['mkfifo', join(root, 'metadata.json')])
            expect(fifo.exitCode).toBe(0)
            const module = new URL(
                '../../../../../../scripts/backup/restore-snapshot.ts',
                import.meta.url,
            ).href
            const child = Bun.spawn(
                [
                    process.execPath,
                    '--no-env-file',
                    '-e',
                    `const {snapshotProductionRestore}=await import(${JSON.stringify(module)});try{await snapshotProductionRestore(process.env.INPUT,process.env.SNAPSHOT);process.exit(1)}catch(error){process.exit(error.message.includes('backup file is missing, invalid or too large')?0:2)}`,
                ],
                {
                    env: { ...process.env, INPUT: root, SNAPSHOT: snapshot },
                    stdout: 'ignore',
                    stderr: 'ignore',
                },
            )
            const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
            try {
                expect(await child.exited).toBe(0)
            } finally {
                clearTimeout(timer)
                if (child.exitCode === null) child.kill('SIGKILL')
            }
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    },
    10000,
)

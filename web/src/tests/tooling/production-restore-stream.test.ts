import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../..')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const artifact = (bytes: Uint8Array) => ({ bytes: bytes.length, sha256: hash(bytes) })
function emptyDirectoryTar() {
    const header = Buffer.alloc(512)
    header.write('./')
    header.write('0000700\0', 100)
    header.write('00000000000\0', 124)
    header.fill(32, 148, 156)
    header[156] = 53
    header.write(
        header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
        148,
    )
    return Buffer.concat([header, Buffer.alloc(1024)])
}

async function restore(scenario: 'success' | 'source-swap' | 'bad-hash' | 'database-failure') {
    await mkdir(join(root, 'tmp'), { recursive: true })
    const directory = await mkdtemp(join(root, 'tmp', 'restore-stream-'))
    const input = join(directory, 'input'),
        bin = join(directory, 'bin')
    await Promise.all([mkdir(input), mkdir(bin)])
    const dump = Buffer.alloc(6 * 1024 ** 2 + 7, 137)
    const key = Buffer.from(Buffer.alloc(32, 17).toString('base64') + '\n')
    const tar = emptyDirectoryTar()
    const metadata = {
        format: 'rentnerproxy-production-backup',
        version: 4,
        createdAt: '2026-10-22T00:00:00Z',
        redis: 'excluded',
        postgres: {
            ...artifact(dump),
            database: 'rentnerproxy',
            user: 'rentnerproxy',
            dump: 'postgres.dump',
        },
        applicationEncryptionKey: { ...artifact(key), file: 'app-encryption-key' },
        controllerState: { ...artifact(tar), archive: 'controller-state.tar' },
        crowdSecState: { ...artifact(tar), archive: 'crowdsec-state.tar' },
        deployment: { publicOrigin: 'https://proxy.test', trustedProxyCidrs: '' },
        source: { imageId: 'sha256:' + 'a'.repeat(64), revision: null, version: null },
    }
    await Promise.all([
        writeFile(join(input, 'metadata.json'), JSON.stringify(metadata)),
        writeFile(
            join(input, 'postgres.dump'),
            scenario === 'bad-hash' ? Buffer.alloc(dump.length) : dump,
        ),
        writeFile(join(input, 'app-encryption-key'), key),
        writeFile(join(input, 'controller-state.tar'), tar),
        writeFile(join(input, 'crowdsec-state.tar'), tar),
        writeFile(join(directory, 'compose.yml'), 'fixture only; docker is replaced'),
    ])
    const fake = join(bin, 'docker')
    await writeFile(
        fake,
        `#!/usr/bin/env -S bun --no-env-file
import { appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
const args = process.argv.slice(2), command = args.join(' ')
const directory = process.env.FIXTURE_DIRECTORY, scenario = process.env.FIXTURE_SCENARIO
appendFileSync(directory + '/calls', JSON.stringify(args) + '\\n')
if (command.includes('config --format=json')) {
    if (scenario === 'source-swap') writeFileSync(directory + '/input/postgres.dump','swapped after validation')
    console.log(JSON.stringify({ services: { rentnerproxy: { image:'fixture',environment:{ RENTNERPROXY_PUBLIC_ORIGIN:'https://proxy.test' } } } }))
} else if (command.startsWith('image inspect ')) {
    console.log('sha256:' + 'a'.repeat(64))
} else if (command.includes('pg_restore')) {
    const mount = args[args.indexOf('--volume') + 1]
    if (!mount.endsWith(':/backup:ro')) process.exit(81)
    const snapshot = mount.slice(0,-11)
    const dump = readFileSync(snapshot + '/postgres.dump')
    if (createHash('sha256').update(dump).digest('hex') !== process.env.FIXTURE_DUMP_HASH) process.exit(82)
    if ((statSync(snapshot + '/postgres.dump').mode & 0o777) !== 0o600) process.exit(83)
    if (readFileSync(0).length !== 0) process.exit(84)
    if (!command.includes('< /backup/postgres.dump') || command.includes('dump_path=')) process.exit(85)
    if (scenario === 'database-failure') { console.error('do-not-leak RESTORE_PHASE=render ERROR: 23514'); process.exit(9) }
} else if (command.includes('ps --status running --quiet')) {
    console.log('fixture-appliance')
}
`,
    )
    await chmod(fake, 0o755)
    try {
        const child = Bun.spawn({
            cmd: [
                process.execPath,
                '--no-env-file',
                join(root, 'scripts/production-restore.ts'),
                '--input',
                input,
                '--confirm-replace',
            ],
            cwd: root,
            env: {
                ...process.env,
                PATH: bin + ':' + process.env.PATH,
                FIXTURE_DIRECTORY: directory,
                FIXTURE_SCENARIO: scenario,
                FIXTURE_DUMP_HASH: hash(dump),
                RENTNERPROXY_COMPOSE_FILE: join(directory, 'compose.yml'),
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [exit, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        const calls: string[][] = (await readFile(join(directory, 'calls'), 'utf8').catch(() => ''))
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        const pg = calls.filter((args) => args.some((arg) => arg.includes('pg_restore')))
        if (pg.length) {
            const mount = pg[0]![pg[0]!.indexOf('--volume') + 1]!
            assert.ok(pg.every((args) => args[args.indexOf('--volume') + 1] === mount))
            await assert.rejects(stat(mount.slice(0, -11)), /ENOENT/)
        }
        return { exit, stdout, stderr, calls, pg }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

test.skipIf(process.platform === 'win32')(
    'restore CLI uses the same verified multi-MiB snapshot for both PostgreSQL phases despite source replacement',
    async () => {
        const result = await restore('source-swap')
        assert.equal(result.exit, 0, result.stderr)
        assert.equal(result.pg.length, 2)
        assert.ok(result.pg.every((args) => !args.includes('--interactive')))
        assert.match(result.stdout, /Production restore completed/)
        assert.ok(result.calls.some((args) => args.includes('--force-recreate')))
    },
)

test.skipIf(process.platform === 'win32')(
    'restore CLI rejects corrupted input before any Docker call',
    async () => {
        const result = await restore('bad-hash')
        assert.equal(result.exit, 1)
        assert.equal(result.calls.length, 0)
        assert.match(result.stderr, /checksum mismatch/)
    },
)

test.skipIf(process.platform === 'win32')(
    'restore PostgreSQL diagnostics remain allowlisted without stdin or appliance startup after failure',
    async () => {
        const result = await restore('database-failure')
        assert.equal(result.exit, 1)
        assert.match(result.stderr, /Restore database phase: render/)
        assert.match(result.stderr, /SQLSTATE: 23514/)
        assert.ok(!result.stderr.includes('do-not-leak'))
        assert.ok(!result.calls.some((args) => args.includes('up') || args.includes('start')))
    },
)

// oxlint-disable no-await-in-loop -- Hermetic build variants share owned absolute builder paths.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')

// Absolute builder paths may only be created in an explicitly opted-in disposable container.
test.skipIf(process.env.RENTNERPROXY_CADDY_BUILD_FIXTURE !== '1' || process.platform !== 'linux')(
    'shared Caddy build enforces source, compiler, patch, binary and module guards',
    async () => {
        const owned = [
            '/opt/rentnerproxy-responsecache',
            '/usr/bin/caddy',
            '/tmp/caddy-crowdsec-http-only.sh',
            '/tmp/verify-caddy-buildinfo.sh',
            '/tmp/caddy-crowdsec-bouncer',
            '/tmp/caddy-crowdsec-bouncer.tar.gz',
            '/tmp/caddy-buildinfo.txt',
        ]
        for (const path of owned)
            assert.equal(existsSync(path), false, 'fixture requires absent builder path: ' + path)
        const directory = await mkdtemp('/tmp/caddy-script-fixture-')
        const bin = join(directory, 'bin'),
            source = join(directory, 'source')
        await Promise.all([
            mkdir(bin),
            mkdir(source),
            mkdir('/tmp/caddy-crowdsec-bouncer'),
            mkdir('/opt/rentnerproxy-responsecache'),
        ])
        try {
            await writeFile(join(source, 'fixture'), 'synthetic source')
            const tarball = join(directory, 'source.tar.gz')
            assert.equal(Bun.spawnSync(['tar', '-czf', tarball, '-C', source, '.']).exitCode, 0)
            const sha256 = createHash('sha256')
                .update(await readFile(tarball))
                .digest('hex')
            await copyFile(
                join(root, 'docker/caddy/tooling/verify-buildinfo.sh'),
                '/tmp/verify-caddy-buildinfo.sh',
            )
            await writeFile(
                '/tmp/caddy-crowdsec-http-only.sh',
                'set -e; test "$FIXTURE_MODE" != patch; printf "patch\\n" >> "$FIXTURE_CALLS"\n',
            )
            const fakeCaddy = `#!/usr/bin/env -S bun --no-env-file
const mode=process.env.FIXTURE_MODE
if(process.argv[2]==='version')console.log(mode==='version'?'v0.0.0':'v2.11.7 fixture')
else { if(mode!=='missing-cache')console.log('http.handlers.rentnerproxy_response_cache'); console.log('crowdsec');if(mode!=='missing-http')console.log('http.handlers.crowdsec');if(mode==='layer4')console.log('layer4.handlers.fixture');if(mode==='appsec')console.log('http.handlers.appsec') }
`
            const buildinfo = `/usr/bin/caddy: go1.27.2\n\tdep\tgolang.org/x/net\tv0.61.0\th1:fixture\n\tdep\tgithub.com/crowdsecurity/crowdsec\tv1.7.0\n\t=>\tgithub.com/crowdsecurity/crowdsec\tv1.8.1\th1:fixture\n\tbuild\tCGO_ENABLED=0\n`
            const fake = `#!/usr/bin/env -S bun --no-env-file
import { basename } from 'node:path'
import { appendFileSync, copyFileSync, writeFileSync, chmodSync } from 'node:fs'
const name=basename(process.argv[1]),args=process.argv.slice(2),mode=process.env.FIXTURE_MODE
appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify([name,...args])+'\\n')
if(name==='wget')copyFileSync(process.env.FIXTURE_TARBALL,args[1])
if(name==='go') {
 if(args[0]==='env')console.log(mode==='compiler'?'go1.27.1':'go1.27.2')
 else { let info=${JSON.stringify(buildinfo)};if(mode==='buildinfo')info=info.replace('CGO_ENABLED=0','CGO_ENABLED=1');if(mode==='crowdsec')info=info.replace('v1.8.1','v1.7.0');process.stdout.write(info) }
}
if(name==='xcaddy'){writeFileSync('/usr/bin/caddy',${JSON.stringify(fakeCaddy)});chmodSync('/usr/bin/caddy',0o755)}
`
            await Promise.all(
                ['go', 'wget', 'xcaddy'].map(async (name) => {
                    const path = join(bin, name)
                    await writeFile(path, fake)
                    await chmod(path, 0o755)
                }),
            )
            const script = join(root, 'docker/caddy/tooling/build.sh')
            assert.equal(Bun.spawnSync(['/bin/sh', '-n', script]).exitCode, 0)
            for (const mode of [
                'success',
                'compiler',
                'hash',
                'patch',
                'buildinfo',
                'crowdsec',
                'version',
                'missing-http',
                'missing-cache',
                'layer4',
                'appsec',
            ]) {
                const callsPath = join(directory, 'calls')
                await writeFile(callsPath, '')
                const child = Bun.spawn(['/bin/sh', script], {
                    cwd: '/tmp/caddy-crowdsec-bouncer',
                    env: {
                        ...process.env,
                        PATH: bin + ':' + process.env.PATH,
                        FIXTURE_MODE: mode,
                        FIXTURE_CALLS: callsPath,
                        FIXTURE_TARBALL: tarball,
                        CADDY_VERSION: 'v2.11.7',
                        CADDY_CROWDSEC_BOUNCER_COMMIT: '6b35f6be25e457aa0b94e32c6ae519123e50e7b7',
                        CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256:
                            mode === 'hash' ? '0'.repeat(64) : sha256,
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                })
                const [exit, stderr] = await Promise.all([
                    child.exited,
                    new Response(child.stderr).text(),
                    new Response(child.stdout).text(),
                ])
                assert.equal(exit === 0, mode === 'success', mode + ': ' + stderr)
                const calls = await readFile(callsPath, 'utf8')
                if (mode === 'compiler') assert.ok(!calls.includes('wget'))
                if (mode === 'hash' || mode === 'patch') assert.ok(!calls.includes('xcaddy'))
                if (mode === 'success') {
                    const compile = calls
                        .split('\n')
                        .filter((line) => line.startsWith('['))
                        .map((line) => JSON.parse(line) as string[])
                        .find((args) => args[0] === 'xcaddy')!
                    assert.deepEqual(compile.slice(0, 5), [
                        'xcaddy',
                        'build',
                        'v2.11.7',
                        '--output',
                        '/usr/bin/caddy',
                    ])
                    assert.ok(
                        compile.includes(
                            'github.com/hslatman/caddy-crowdsec-bouncer/http@6b35f6be25e457aa0b94e32c6ae519123e50e7b7',
                        ),
                    )
                }
            }
        } finally {
            await Promise.all(owned.map((path) => rm(path, { recursive: true, force: true })))
            await rm(directory, { recursive: true, force: true })
        }
    },
)

// oxlint-disable no-await-in-loop -- Hermetic variants share owned absolute builder paths.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')

// Absolute builder paths belong exclusively to an opted-in disposable container.
test.skipIf(process.env.RENTNERPROXY_CADDY_BUILD_FIXTURE !== '1' || process.platform !== 'linux')(
    'shared Caddy build enforces upstream pins, compiler, binary and required modules',
    async () => {
        const owned = [
            '/opt/rentnerproxy-responsecache',
            '/opt/rentnerproxy-caddy-source',
            '/tmp/prepare-caddy-source.sh',
            '/usr/bin/caddy',
            '/tmp/verify-buildinfo.go',
            '/tmp/verify-buildinfo',
            '/tmp/rentnerproxy-caddy',
            '/tmp/caddy-buildinfo.txt',
        ]
        for (const path of owned)
            assert.equal(existsSync(path), false, 'fixture requires absent builder path: ' + path)
        const directory = await mkdtemp('/tmp/caddy-script-fixture-')
        const bin = join(directory, 'bin')
        await Promise.all([
            mkdir(bin),
            mkdir('/tmp/rentnerproxy-caddy'),
            mkdir('/opt/rentnerproxy-responsecache'),
        ])
        try {
            await copyFile(
                join(root, 'docker/tooling/buildinfo/verify.go'),
                '/tmp/verify-buildinfo.go',
            )
            const prepare = join(directory, 'prepare-caddy-source.sh')
            await writeFile(
                prepare,
                `#!/bin/sh
set -eu
printf '%s\\n' '["prepare-caddy-source"]' >> "$FIXTURE_CALLS"
[ "$FIXTURE_MODE" != preparation ] || exit 1
mkdir -p /opt/rentnerproxy-caddy-source
`,
            )
            await copyFile(prepare, '/tmp/prepare-caddy-source.sh')
            const fakeCaddy = `#!/usr/bin/env -S bun --no-env-file
const mode=process.env.FIXTURE_MODE
if(process.argv[2]==='version')console.log(mode==='version'?'v0.0.0':'v2.11.7 fixture')
else { if(mode!=='missing-cache')console.log('http.handlers.rentnerproxy_response_cache'); console.log('crowdsec');if(mode!=='missing-http')console.log('http.handlers.crowdsec');console.log('layer4');console.log('http.handlers.appsec') }
`
            const fake = `#!/usr/bin/env -S bun --no-env-file
import { basename } from 'node:path'
import { appendFileSync, writeFileSync, chmodSync } from 'node:fs'
const name=basename(process.argv[1]),args=process.argv.slice(2),mode=process.env.FIXTURE_MODE
appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify([name,...args])+'\\n')
if(name==='go') {
 if(args[0]==='env')console.log(mode==='compiler'?'go1.27.1':'go1.27.3')
 else if(args[0]==='version') console.log('/usr/bin/caddy: go1.27.3')
 else if(args[0]==='build') {
  if(mode==='validator-build')process.exit(1)
  writeFileSync('/tmp/verify-buildinfo', '#!/bin/sh\\n[ "$1" = caddy ] && [ "$2" = /usr/bin/caddy ] && [ "$FIXTURE_MODE" != metadata ]\\n');chmodSync('/tmp/verify-buildinfo',0o755)
 }
}
if(name==='xcaddy'){
 if(mode==='build')process.exit(1)
 writeFileSync('/usr/bin/caddy',${JSON.stringify(fakeCaddy)});chmodSync('/usr/bin/caddy',0o755)
}
`
            await Promise.all(
                ['go', 'xcaddy'].map(async (name) => {
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
                'preparation',
                'build',
                'validator-build',
                'metadata',
                'version',
                'missing-http',
                'missing-cache',
            ]) {
                const callsPath = join(directory, 'calls')
                await writeFile(callsPath, '')
                await rm('/opt/rentnerproxy-caddy-source', { recursive: true, force: true })
                const child = Bun.spawn(['/bin/sh', script], {
                    cwd: '/tmp/rentnerproxy-caddy',
                    env: {
                        ...process.env,
                        PATH: bin + ':' + process.env.PATH,
                        FIXTURE_MODE: mode,
                        FIXTURE_CALLS: callsPath,
                        CADDY_VERSION: 'v2.11.7',
                        CADDY_CROWDSEC_BOUNCER_VERSION: 'v0.14.2-0.20261030164527-4a6ce1d3094d',
                        CADDY_LAYER4_VERSION: 'v0.1.3-0.20261029145729-f607ccea1b7d',
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
                if (mode === 'compiler' || mode === 'preparation')
                    assert.ok(!calls.includes('xcaddy'))
                if (mode === 'preparation') {
                    assert.ok(calls.includes('prepare-caddy-source'))
                    assert.ok(!calls.includes('"edit"'))
                    assert.equal(existsSync('/opt/rentnerproxy-caddy-source'), false)
                }
                if (mode === 'success') {
                    const commands = calls
                        .split('\n')
                        .filter((line) => line.startsWith('['))
                        .map((line) => JSON.parse(line) as string[])
                    const compile = commands.find((args) => args[0] === 'xcaddy')!
                    const verifyIndex = commands.findIndex(
                        (args) => args[0] === 'go' && args[1] === 'mod' && args[2] === 'verify',
                    )
                    const prepareIndex = commands.findIndex(
                        (args) => args[0] === 'prepare-caddy-source',
                    )
                    const replaceIndex = commands.findIndex(
                        (args) => args[0] === 'go' && args[1] === 'mod' && args[2] === 'edit',
                    )
                    const testIndex = commands.findIndex(
                        (args) => args[0] === 'go' && args[1] === 'test',
                    )
                    const buildIndex = commands.indexOf(compile)
                    assert.ok(verifyIndex >= 0 && verifyIndex < prepareIndex)
                    assert.ok(
                        prepareIndex < replaceIndex &&
                            replaceIndex < testIndex &&
                            testIndex < buildIndex,
                    )
                    assert.deepEqual(commands[replaceIndex], [
                        'go',
                        'mod',
                        'edit',
                        '-replace',
                        'github.com/caddyserver/caddy/v2=/opt/rentnerproxy-caddy-source',
                    ])
                    assert.equal(existsSync('/opt/rentnerproxy-caddy-source'), true)
                    assert.ok(
                        compile.includes(
                            'github.com/caddyserver/caddy/v2=/opt/rentnerproxy-caddy-source',
                        ),
                    )
                    assert.deepEqual(compile.slice(0, 5), [
                        'xcaddy',
                        'build',
                        'v2.11.7',
                        '--output',
                        '/usr/bin/caddy',
                    ])
                    assert.ok(
                        compile.includes(
                            'github.com/hslatman/caddy-crowdsec-bouncer/http@v0.14.2-0.20261030164527-4a6ce1d3094d',
                        ),
                    )
                    assert.ok(
                        compile.includes(
                            'github.com/mholt/caddy-l4=github.com/mholt/caddy-l4@v0.1.3-0.20261029145729-f607ccea1b7d',
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

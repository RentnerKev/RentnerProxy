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
            '/usr/bin/caddy',
            '/tmp/verify-caddy-buildinfo.sh',
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
                join(root, 'docker/caddy/tooling/verify-buildinfo.sh'),
                '/tmp/verify-caddy-buildinfo.sh',
            )
            const fakeCaddy = `#!/usr/bin/env -S bun --no-env-file
const mode=process.env.FIXTURE_MODE
if(process.argv[2]==='version')console.log(mode==='version'?'v0.0.0':'v2.11.7 fixture')
else { if(mode!=='missing-cache')console.log('http.handlers.rentnerproxy_response_cache'); console.log('crowdsec');if(mode!=='missing-http')console.log('http.handlers.crowdsec');console.log('layer4');console.log('http.handlers.appsec') }
`
            const buildinfo = `/usr/bin/caddy: go1.27.2\n\tdep\tgolang.org/x/net\tv0.61.0\th1:fixture\n\tdep\tgithub.com/hslatman/caddy-crowdsec-bouncer\tv0.14.2-0.20260909201224-ffdcb7c6f861\n\tdep\tgithub.com/mholt/caddy-l4\tv0.1.1\n\t=>\tgithub.com/mholt/caddy-l4\tv0.1.3-0.20261023161224-4ad6aec1ccc6\th1:layer4\n\tdep\tgithub.com/crowdsecurity/crowdsec\tv1.7.0\n\t=>\tgithub.com/crowdsecurity/crowdsec\tv1.8.1\th1:fixture\n\tbuild\tCGO_ENABLED=0\n`
            const fake = `#!/usr/bin/env -S bun --no-env-file
import { basename } from 'node:path'
import { appendFileSync, writeFileSync, chmodSync } from 'node:fs'
const name=basename(process.argv[1]),args=process.argv.slice(2),mode=process.env.FIXTURE_MODE
appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify([name,...args])+'\\n')
if(name==='go') {
 if(args[0]==='env')console.log(mode==='compiler'?'go1.27.1':'go1.27.2')
 else if(args[0]==='version') {
  let info=${JSON.stringify(buildinfo)}
  if(mode==='buildinfo')info=info.replace('CGO_ENABLED=0','CGO_ENABLED=1')
  if(mode==='crowdsec')info=info.replace('v1.8.1','v1.7.0')
  if(mode==='bouncer')info=info.replace('v0.14.2-0.20260909201224-ffdcb7c6f861','v0.14.1')
  if(mode==='layer4-version')info=info.replace('v0.1.3-0.20261023161224-4ad6aec1ccc6','v0.1.1')
  if(mode==='fork')info+='\\tdep\\tforeign/module\\tv1.0.0\\n\\t=>\\t/tmp/patched-source\\t(devel)\\n'
  process.stdout.write(info)
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
                'build',
                'buildinfo',
                'crowdsec',
                'bouncer',
                'layer4-version',
                'fork',
                'version',
                'missing-http',
                'missing-cache',
            ]) {
                const callsPath = join(directory, 'calls')
                await writeFile(callsPath, '')
                const child = Bun.spawn(['/bin/sh', script], {
                    cwd: '/tmp/rentnerproxy-caddy',
                    env: {
                        ...process.env,
                        PATH: bin + ':' + process.env.PATH,
                        FIXTURE_MODE: mode,
                        FIXTURE_CALLS: callsPath,
                        CADDY_VERSION: 'v2.11.7',
                        CADDY_CROWDSEC_BOUNCER_COMMIT: 'ffdcb7c6f8619effc7510bc0db0edec3609a1d28',
                        CADDY_LAYER4_VERSION: 'v0.1.3-0.20261023161224-4ad6aec1ccc6',
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
                if (mode === 'compiler') assert.ok(!calls.includes('xcaddy'))
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
                            'github.com/hslatman/caddy-crowdsec-bouncer/http@ffdcb7c6f8619effc7510bc0db0edec3609a1d28',
                        ),
                    )
                    assert.ok(
                        compile.includes(
                            'github.com/mholt/caddy-l4=github.com/mholt/caddy-l4@v0.1.3-0.20261023161224-4ad6aec1ccc6',
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

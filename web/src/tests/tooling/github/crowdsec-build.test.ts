import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const buildRoot = resolve(import.meta.dir, '../../../../../docker/crowdsec/tooling/engine-build')
const shell =
    Bun.which('sh') ??
    (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/sh.exe')
        ? 'C:/Program Files/Git/usr/bin/sh.exe'
        : null)
const validBuildinfo = `crowdsec: go1.27.1
\tpath\tgithub.com/crowdsecurity/crowdsec/cmd/crowdsec
\tdep\tgoogle.golang.org/grpc\tv1.83.2\th1:grpc
\tdep\tgolang.org/x/crypto\tv0.57.0\th1:crypto
\tdep\tgolang.org/x/time\tv0.15.0
\t=>\tgithub.com/crowdsecurity/time\tv0.13.0-crowdsec.20250912\th1:time
\tdep\tgithub.com/corazawaf/coraza/v3\tv3.7.0
\t=>\tgithub.com/crowdsecurity/coraza/v3\tv3.7.0-crowdsec.20260730\th1:coraza
\tbuild\t-tags=netgo,osusergo,expr_debug,nomsgpack,sqlite_omit_load_extension,re2_cgo
\tbuild\tCGO_ENABLED=1
`

describe('pinned full-feature CrowdSec source rebuild', () => {
    test('binds immutable official source, authenticated frozen locks and native upstream build', async () => {
        const script = await readFile(join(buildRoot, 'build.sh'), 'utf8')
        expect(script).toContain('source_commit=909b5157986a2b2c2163300fdaef5ed01289f7d2')
        expect(script).toContain(
            'source_sha256=6a9219a2a2706e35b723750d581c697db54d32d1b3995216cc2838329e15f7dc',
        )
        expect(script).toContain('re2_version=2023-03-01')
        expect(script).toContain(
            're2_sha256=7a9a4824958586980926a300b4717202485c4b4115ac031822e29aa4ef207e48',
        )
        expect(script.indexOf('sha256sum --check --strict -')).toBeLessThan(
            script.indexOf('tar -xzf'),
        )
        for (const contract of [
            'export GOTOOLCHAIN=local',
            'export GOSUMDB=sum.golang.org',
            'export GOFLAGS=-mod=readonly',
            'export CGO_ENABLED=1',
            'test "$(go env GOVERSION)" = go1.27.1',
            'pkg-config --exists re2',
            'test "$(pkg-config --variable=libdir re2)" = /usr/local/lib',
            'test "$(pkg-config --variable=includedir re2)" = /usr/local/include',
            'go mod verify',
            'make build BUILD_VERSION=v1.8.1',
            'BUILD_PROFILE=default EXCLUDE= BUILD_SQLITE=mattn BUILD_RE2_WASM=0 BUILD_STATIC=1',
            'make -C "$work_root/re2" install',
            'ldd "$binary_path"',
            'Expected a fully static $binary',
            'for binary in crowdsec cscli',
            'for plugin_dir in cmd/notification-*',
        ])
            expect(script).toContain(contract)
        expect(
            script.match(/sha256sum --check --strict "\$work_root\/locks.sha256"/g),
        ).toHaveLength(2)
        expect(script).not.toMatch(/go (get|test|run)|@latest|GOSUMDB=off|no_db_/)

        const mod = await readFile(join(buildRoot, 'go.mod'), 'utf8')
        const sums = await readFile(join(buildRoot, 'go.sum'), 'utf8')
        for (const [module, version] of [
            ['google.golang.org/grpc', 'v1.83.2'],
            ['golang.org/x/crypto', 'v0.57.0'],
        ]) {
            expect(mod).toContain(`${module} ${version}`)
            for (const suffix of ['', '/go.mod'])
                expect(sums).toContain(`${module} ${version}${suffix} h1:`)
        }
        // These unresolved components stay present; this change does not drop features.
        expect(mod).toContain('github.com/jackc/pgx/v4 v4.18.3')
        expect(mod).toContain('github.com/go-sql-driver/mysql')
        expect(mod).toContain('github.com/mattn/go-sqlite3')
        expect(mod.match(/^replace .+$/gm)).toEqual([
            'replace golang.org/x/time => github.com/crowdsecurity/time v0.13.0-crowdsec.20250912',
            'replace github.com/corazawaf/coraza/v3 => github.com/crowdsecurity/coraza/v3 v3.7.0-crowdsec.20260730',
        ])
    })

    test('actual binary metadata rejects wrong toolchain, module versions, replacements and lost native flags', async () => {
        if (!shell) throw new Error('A POSIX shell is required to verify the build contract')
        const directory = await mkdtemp(join(tmpdir(), 'crowdsec-buildinfo-'))
        try {
            const variants = [
                [validBuildinfo, true],
                [validBuildinfo.replace('go1.27.1', 'go1.27.0'), false],
                [validBuildinfo.replace('v1.83.2', 'v1.83.0'), false],
                [validBuildinfo.replace('v0.57.0', 'v0.55.0'), false],
                [validBuildinfo.replace('CGO_ENABLED=1', 'CGO_ENABLED=0'), false],
                [validBuildinfo.replace(',re2_cgo', ''), false],
                [validBuildinfo.replace(',sqlite_omit_load_extension', ''), false],
                [validBuildinfo + '\t=>\tlocal/fork\tv1.0.0\n', false],
                [
                    validBuildinfo.replace(
                        '\tdep\tgolang.org/x/crypto',
                        '\t=>\tgithub.com/crowdsecurity/time\tv0.13.0-crowdsec.20250912\n\tdep\tgolang.org/x/crypto',
                    ),
                    false,
                ],
                ['', false],
            ] as const
            const outcomes = await Promise.all(
                variants.map(async ([metadata, accepted], index) => {
                    const filename = join(directory, `buildinfo-${index}.txt`)
                    await writeFile(filename, metadata)
                    const child = Bun.spawn(
                        [
                            shell,
                            '-c',
                            'export PATH="/usr/bin:$PATH"; exec sh "$@"',
                            'crowdsec-buildinfo-test',
                            join(buildRoot, 'verify-buildinfo.sh'),
                            filename,
                        ],
                        { stdout: 'pipe', stderr: 'pipe' },
                    )
                    const [stderr, exitCode] = await Promise.all([
                        new Response(child.stderr).text(),
                        child.exited,
                    ])
                    return { accepted, actual: { accepted: exitCode === 0, stderr } }
                }),
            )
            for (const outcome of outcomes)
                expect(outcome.actual).toEqual({ accepted: outcome.accepted, stderr: '' })
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})

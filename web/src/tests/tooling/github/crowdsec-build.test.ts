import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const buildRoot = resolve(import.meta.dir, '../../../../../docker/crowdsec/tooling/engine-build')
const gitBash = 'C:/Program Files/Git/bin/bash.exe'
const shell = process.platform === 'win32' && existsSync(gitBash) ? gitBash : Bun.which('bash')
const validBuildinfo = `crowdsec: go1.27.2
\tpath\tgithub.com/crowdsecurity/crowdsec/cmd/crowdsec
\tdep\tgoogle.golang.org/grpc\tv1.84.0\th1:grpc
\tdep\tgolang.org/x/crypto\tv0.58.0\th1:crypto
\tdep\tgolang.org/x/net\tv0.61.0\th1:net
\tdep\tgolang.org/x/time\tv0.16.0
\t=>\tgithub.com/crowdsecurity/time\tv0.13.0-crowdsec.20250912\th1:time
\tdep\tgithub.com/corazawaf/coraza/v3\tv3.8.1
\t=>\tgithub.com/crowdsecurity/coraza/v3\tv3.8.0-crowdsec.20261002\th1:coraza
\tbuild\t-tags=netgo,osusergo,expr_debug,nomsgpack,sqlite_omit_load_extension,re2_cgo,no_db_postgres
\tbuild\tCGO_ENABLED=1
`

async function runShell(script: string, ...args: string[]) {
    if (!shell) throw new Error('A POSIX shell is required to verify the build contract')
    const child = Bun.spawn(
        [
            shell,
            '-c',
            'export PATH="/usr/bin:$PATH"; exec sh "$@"',
            'crowdsec-build-test',
            script,
            ...args,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    return { stdout, stderr, accepted: exitCode === 0 }
}

describe('pinned pristine CrowdSec appliance rebuild', () => {
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
            'test "$(go env GOVERSION)" = go1.27.2',
            'pkg-config --exists re2',
            'test "$(pkg-config --variable=libdir re2)" = /usr/local/lib',
            'test "$(pkg-config --variable=includedir re2)" = /usr/local/include',
            'go mod verify',
            'make build BUILD_VERSION=v1.8.1',
            'BUILD_PROFILE=default EXCLUDE=db_postgres PLUGINS= BUILD_SQLITE=mattn BUILD_RE2_WASM=0 BUILD_STATIC=1',
            'make -C "$work_root/re2" install',
            'ldd "$binary_path"',
            'Expected a fully static $binary',
            'for binary in crowdsec cscli',
            'export GOWORK="$work_root/go.work"',
            'cp "$script_root/go.mod" "$script_root/go.sum" "$work_root/pins/"',
            'cp "$script_root/go.work.template" "$work_root/go.work"',
            'cp "$script_root/go.work.sum" "$work_root/go.work.sum"',
            'find . -type f -print0 | sort -z | xargs -0 sha256sum',
            '/bin/sh "$script_root/verify-packages.sh" "$work_root/packages.txt"',
        ])
            expect(script).toContain(contract)
        expect(
            script.match(/sha256sum --check --strict "\$work_root\/locks.sha256"/g),
        ).toHaveLength(2)
        expect(
            script.match(/sha256sum --check --strict "\$work_root\/source-files.sha256"/g),
        ).toHaveLength(2)
        expect(script).not.toMatch(
            /go (get|test|run)|@latest|GOSUMDB=off|patch-postgres|cp .+"\$work_root\/source\/"/,
        )
        expect(existsSync(join(buildRoot, 'patch-postgres.sh'))).toBe(false)

        const mod = await readFile(join(buildRoot, 'go.mod'), 'utf8')
        const sums = await readFile(join(buildRoot, 'go.sum'), 'utf8')
        for (const [module, version] of [
            ['google.golang.org/grpc', 'v1.84.0'],
            ['golang.org/x/crypto', 'v0.58.0'],
            ['golang.org/x/net', 'v0.61.0'],
        ]) {
            expect(mod).toContain(`${module} ${version}`)
            for (const suffix of ['', '/go.mod'])
                expect(sums).toContain(`${module} ${version}${suffix} h1:`)
        }
        expect(mod).toContain('go 1.27.2')
        expect(mod).toContain('module rentnerproxy.local/crowdsec-dependencies')
        const workspace = await readFile(join(buildRoot, 'go.work.template'), 'utf8')
        const workspaceSums = await readFile(join(buildRoot, 'go.work.sum'), 'utf8')
        expect(workspace).toContain('go 1.27.2')
        expect(workspace).toContain('./source')
        expect(workspace).toContain('./pins')
        expect(workspace).not.toMatch(/\/work\/|[A-Z]:\\/)
        expect(workspaceSums).toContain(' h1:')
        for (const lock of [mod, sums])
            expect(lock).not.toMatch(/github\.com\/jackc\/(pgx\/v4|pgproto3\/v2|pgconn|pgtype)\s/)
        expect(mod).toContain('github.com/go-sql-driver/mysql')
        expect(mod).toContain('github.com/mattn/go-sqlite3')
        expect(mod.match(/^replace .+$/gm)).toEqual([
            'replace golang.org/x/time => github.com/crowdsecurity/time v0.13.0-crowdsec.20250912',
            'replace github.com/corazawaf/coraza/v3 => github.com/crowdsecurity/coraza/v3 v3.8.0-crowdsec.20261002',
        ])
        expect(workspace.match(/^replace .+$/gm)).toEqual(mod.match(/^replace .+$/gm))
        const managedConfigs = await Promise.all(
            ['config.yaml', 'config-online.yaml'].map((config) =>
                readFile(resolve(buildRoot, '../../runtime', config), 'utf8'),
            ),
        )
        for (const managed of managedConfigs) {
            expect(managed).toMatch(/db_config:\s+log_level: info\s+type: sqlite/)
        }
    })

    test('actual binary metadata rejects wrong toolchain, module versions, replacements and lost native flags', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'crowdsec-buildinfo-'))
        try {
            const variants = [
                [validBuildinfo, true],
                [validBuildinfo.replace('go1.27.2', 'go1.27.1'), false],
                [validBuildinfo.replace('v1.84.0', 'v1.83.0'), false],
                [validBuildinfo.replace('v0.58.0', 'v0.55.0'), false],
                [validBuildinfo.replace('v0.61.0', 'v0.58.0'), false],
                [
                    validBuildinfo.replace('v3.8.0-crowdsec.20261002', 'v3.7.0-crowdsec.20260730'),
                    false,
                ],
                [validBuildinfo + '\tdep\tgithub.com/jackc/pgx/v4\tv4.18.3\th1:old\n', false],
                [validBuildinfo + '\tdep\tgithub.com/jackc/pgproto3/v2\tv2.3.3\th1:old\n', false],
                [validBuildinfo + '\tdep\tgithub.com/jackc/pgconn\tv1.14.3\th1:old\n', false],
                [validBuildinfo + '\tdep\tgithub.com/jackc/pgtype\tv1.14.4\th1:old\n', false],
                [validBuildinfo.replace('CGO_ENABLED=1', 'CGO_ENABLED=0'), false],
                [validBuildinfo.replace(',re2_cgo', ''), false],
                [validBuildinfo.replace(',sqlite_omit_load_extension', ''), false],
                [validBuildinfo.replace(',no_db_postgres', ''), false],
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
                    return {
                        accepted,
                        actual: await runShell(join(buildRoot, 'verify-buildinfo.sh'), filename),
                    }
                }),
            )
            for (const outcome of outcomes)
                expect(outcome.actual).toEqual({
                    accepted: outcome.accepted,
                    stdout: '',
                    stderr: '',
                })
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('retains all datasources and managed database backends while rejecting obsolete packages', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'crowdsec-packages-'))
        const datasources = [
            'appsec',
            'cloudwatch',
            'docker',
            'file',
            'http',
            'journalctl',
            'kafka',
            'kinesis',
            'kubernetes',
            'kubernetesaudit',
            'loki',
            's3',
            'syslog',
            'victorialogs',
            'wineventlog',
        ]
        const packages = [
            ...datasources.map(
                (source) => 'github.com/crowdsecurity/crowdsec/pkg/acquisition/modules/' + source,
            ),
            'github.com/go-sql-driver/mysql',
            'github.com/mattn/go-sqlite3',
            'golang.org/x/crypto/bcrypt',
        ]
        try {
            const filename = join(directory, 'packages.txt')
            await writeFile(filename, packages.join('\n') + '\n')
            expect(await runShell(join(buildRoot, 'verify-packages.sh'), filename)).toEqual({
                accepted: true,
                stdout: '',
                stderr: '',
            })
            const forbiddenPackages = [
                'github.com/jackc/pgx/v4/stdlib',
                'github.com/jackc/pgproto3/v2',
                'github.com/jackc/pgconn',
                'github.com/jackc/pgtype',
                'golang.org/x/crypto/openpgp',
                'golang.org/x/crypto/openpgp/packet',
            ]
            const forbiddenOutcomes = await Promise.all(
                forbiddenPackages.map(async (forbidden, index) => {
                    const variant = join(directory, `forbidden-${index}.txt`)
                    await writeFile(variant, [...packages, forbidden].join('\n') + '\n')
                    return runShell(join(buildRoot, 'verify-packages.sh'), variant)
                }),
            )
            for (const rejected of forbiddenOutcomes) {
                expect(rejected.accepted).toBe(false)
                expect(rejected.stderr).toContain('obsolete PostgreSQL or OpenPGP package')
            }
            const missingBackendOutcomes = await Promise.all(
                packages.slice(0, -1).map(async (backend, index) => {
                    const variant = join(directory, `missing-${index}.txt`)
                    await writeFile(
                        variant,
                        packages.filter((value) => value !== backend).join('\n'),
                    )
                    return runShell(join(buildRoot, 'verify-packages.sh'), variant)
                }),
            )
            for (const rejected of missingBackendOutcomes) expect(rejected.accepted).toBe(false)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})

import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const script = resolve(import.meta.dir, '../../../../../../docker/production/verify-platform.sh')

function shellPath(path: string): string {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`)
        : normalized
}

for (const scenario of [
    { name: 'AMD64 dynamic executable', accepted: true },
    { name: 'ARM64 dynamic executable', architecture: 'arm64', machine: 183, accepted: true },
    {
        name: 'static executable',
        linkage: 'not a dynamic executable',
        lddStatus: 1,
        accepted: true,
    },
    { name: 'static PIE executable', linkage: 'statically linked', accepted: true },
    { name: 'wrong copied binary architecture', machine: 183 },
    { name: 'AMD64 binary in an ARM64 image', architecture: 'arm64' },
    { name: 'wrong base image architecture', dpkgArchitecture: 'arm64' },
    { name: 'missing runtime library', linkage: 'libfixture.so => not found' },
    { name: 'invalid linkage', linkage: 'invalid ELF', lddStatus: 1 },
    { name: '32-bit executable', elfClass: 1 },
    { name: 'big-endian executable', endianness: 2 },
    { name: 'non-ELF executable', magic: 'nope' },
    { name: 'unsupported architecture', architecture: 's390x' },
    { name: 'unsupported operating system', os: 'windows' },
]) {
    test(`appliance platform verification: ${scenario.name}`, async () => {
        const options = {
            architecture: 'amd64',
            dpkgArchitecture: undefined as string | undefined,
            os: 'linux',
            machine: 62,
            elfClass: 2,
            endianness: 1,
            magic: '\x7fELF',
            linkage: 'libc.so.6 => /lib/fixture/libc.so.6',
            lddStatus: 0,
            accepted: false,
            ...scenario,
        }
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-platform-'))
        try {
            const tools = join(directory, 'tools')
            await mkdir(tools)
            const binary = Buffer.alloc(64)
            binary.write(options.magic, 'ascii')
            binary[4] = options.elfClass
            binary[5] = options.endianness
            binary.writeUInt16LE(options.machine, 18)
            await Promise.all([
                writeFile(join(directory, 'binary'), binary),
                writeFile(join(tools, 'dpkg'), '#!/bin/sh\nprintf "%s\\n" "$DPKG_ARCH"\n', {
                    mode: 0o755,
                }),
                writeFile(
                    join(tools, 'ldd'),
                    '#!/bin/sh\nprintf "%s\\n" "$LINKAGE"\nexit "$LDD_STATUS"\n',
                    { mode: 0o755 },
                ),
            ])
            const child = Bun.spawn(
                [
                    shell,
                    '--noprofile',
                    '--norc',
                    '-c',
                    'export PATH="$TOOL_DIRECTORY:/usr/bin:/bin"; chmod +x "$TOOL_DIRECTORY"/*; exec /bin/sh "$VERIFY_SCRIPT" "$TARGET_OS" "$TARGET_ARCH" "$TEST_BINARY"',
                ],
                {
                    env: {
                        PATH: '/usr/bin:/bin',
                        TOOL_DIRECTORY: shellPath(tools),
                        VERIFY_SCRIPT: shellPath(script),
                        TEST_BINARY: shellPath(join(directory, 'binary')),
                        TARGET_OS: options.os,
                        TARGET_ARCH: options.architecture,
                        DPKG_ARCH: options.dpkgArchitecture ?? options.architecture,
                        LINKAGE: options.linkage,
                        LDD_STATUS: String(options.lddStatus),
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [stdout, stderr, status] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ])
            expect(status, stdout + stderr).toBe(options.accepted ? 0 : 1)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
}

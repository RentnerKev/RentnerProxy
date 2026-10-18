import { expect } from 'bun:test'
import { fileURLToPath } from 'node:url'

import type { BunScriptOptions } from './Types/bun-script.types.ts'

export async function runBunScript(script: string, options: BunScriptOptions): Promise<string> {
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
        cwd: options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd,
        ...(options.env ? { env: options.env } : {}),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    return stdout
}

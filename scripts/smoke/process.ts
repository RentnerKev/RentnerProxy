import type { SmokeProcessOptions, SmokeProcessResult } from './Types/process.types.ts'

export async function runSmokeProcess(
    args: string[],
    options: SmokeProcessOptions,
): Promise<SmokeProcessResult> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error('Smoke process timeout must be a positive finite number')
    }
    const child = Bun.spawn({
        cmd: args,
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
        stdout: options.inherit ? 'inherit' : 'pipe',
        stderr: options.inherit ? 'inherit' : 'pipe',
    })
    let timedOut = false
    const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
    }, options.timeoutMs)

    try {
        const [exitCode, stdout, stderr] = await Promise.all([
            child.exited,
            child.stdout && typeof child.stdout !== 'number'
                ? new Response(child.stdout).text()
                : Promise.resolve(''),
            child.stderr && typeof child.stderr !== 'number'
                ? new Response(child.stderr).text()
                : Promise.resolve(''),
        ])
        return { exitCode, stdout, stderr, timedOut }
    } finally {
        clearTimeout(timeout)
    }
}

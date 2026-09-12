import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('auth failures preserve results and exceptions without recording operation inputs', async () => {
    const child = Bun.spawn(
        [
            process.execPath,
            '-e',
            `
        import { mock } from 'bun:test'
        const events = []
        mock.module('./server/Audit/audit.service.ts', () => ({
            recordAuditEventBestEffort: async event => { events.push(event) },
        }))
        const { auditAuthOperation } = await import('./server/Auth/Core/audit-auth.server.ts')
        const event = { actorUserId:null, actorKind:'anonymous', action:'login', resource:'session', targetId:null }
        const success = { success:true, token:'SECRET-TOKEN' }
        if (await auditAuthOperation(event, async () => success) !== success) throw Error('success identity')
        const failed = { success:false, code:'SECRET-RAW-ERROR' }
        if (await auditAuthOperation(event, async () => failed) !== failed) throw Error('failure identity')
        await auditAuthOperation(event, async () => false)
        const denied = Object.assign(new Error('SECRET-PASSWORD'), {code:'permission_denied'})
        try { await auditAuthOperation(event, async () => { throw denied }) } catch (error) {
            if (error !== denied) throw Error('error identity')
        }
        for (const code of ['RATE_LIMITED', 'RATE_LIMIT_UNAVAILABLE']) {
            const limited = Object.assign(new Error('throttled'), { code })
            try { await auditAuthOperation(event, async () => { throw limited }) } catch (error) {
                if (error !== limited) throw Error('throttle identity')
            }
        }
        console.log(JSON.stringify(events))
    `,
        ],
        { cwd: fileURLToPath(new URL('../', import.meta.url)), stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(code, stderr).toBe(0)
    expect(stdout).not.toContain('SECRET')
    expect((JSON.parse(stdout) as Array<{ result: string }>).map((event) => event.result)).toEqual([
        'failure',
        'failure',
        'denied',
    ])
})

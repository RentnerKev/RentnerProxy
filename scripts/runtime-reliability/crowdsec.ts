import type { ManagedStatus } from './Types/crowdsec.types.ts'
import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { ReliabilityError } from './harness.ts'
import type { ReliabilityContext } from './Types/harness.types.ts'

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ReliabilityError('assertion', 'CrowdSec status was not an object')
    }
    return value as Record<string, unknown>
}

async function managedStatus(context: ReliabilityContext): Promise<ManagedStatus> {
    const response = await context.controller('/internal/v1/crowdsec/status')
    assert.equal(response.status, 200)
    const body = record(response.body)
    if (
        body.mode !== 'managed' ||
        body.communityEnabled !== false ||
        body.communityState !== 'disabled' ||
        body.consoleState !== 'not_enrolled' ||
        body.failureBehavior !== 'fail_open' ||
        body.clientIpSource !== 'caddy' ||
        typeof body.enforcementActive !== 'boolean' ||
        typeof body.credentialConfigured !== 'boolean' ||
        !['disabled', 'starting', 'connected', 'degraded'].includes(String(body.state)) ||
        !['stopped', 'starting', 'ready', 'restarting', 'degraded', 'unavailable'].includes(
            String(body.managedEngine),
        )
    ) {
        throw new ReliabilityError('assertion', 'CrowdSec safe status contract did not match')
    }
    return {
        state: body.state as ManagedStatus['state'],
        managedEngine: body.managedEngine as ManagedStatus['managedEngine'],
    }
}

async function supervisorRestarts(context: ReliabilityContext): Promise<number> {
    const value: unknown = JSON.parse(
        await context.docker([
            'exec',
            context.container,
            'cat',
            '/run/rentnerproxy/crowdsec/status.json',
        ]),
    )
    const status = record(value)
    if (
        typeof status.state !== 'string' ||
        !['stopped', 'starting', 'ready', 'restarting', 'degraded'].includes(status.state) ||
        typeof status.restarts !== 'number' ||
        !Number.isSafeInteger(status.restarts) ||
        status.restarts < 0 ||
        status.restarts > 10_000 ||
        status.community !== 'disabled' ||
        status.console !== 'not_enrolled'
    ) {
        throw new ReliabilityError('assertion', 'CrowdSec supervisor safe status did not match')
    }
    return status.restarts
}

function privateClientIp(value: unknown): string {
    if (typeof value !== 'string' || isIP(value) !== 4) {
        throw new ReliabilityError('assertion', 'CrowdSec fixture client IP was not IPv4')
    }
    const octets = value.split('.').map(Number)
    if (
        octets[0] !== 10 &&
        octets[0] !== 127 &&
        !(octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) &&
        !(octets[0] === 192 && octets[1] === 168)
    ) {
        throw new ReliabilityError(
            'assertion',
            'CrowdSec fixture client IP was not private or loopback',
        )
    }
    return value
}

async function enginePid(context: ReliabilityContext): Promise<string> {
    const script = `import { readdir, readFile } from 'node:fs/promises';
const matches=[];
for(const entry of await readdir('/proc')) {
    if(!/^\\d+$/.test(entry)) continue;
    try { if((await readFile('/proc/'+entry+'/comm','utf8')).trim()==='crowdsec') matches.push(entry); } catch {}
}
if(matches.length!==1) process.exit(1);
process.stdout.write(matches[0]);`
    const pid = await context.docker([
        'exec',
        context.container,
        'bun',
        '--no-env-file',
        '-e',
        script,
    ])
    if (!/^[1-9]\d{0,9}$/u.test(pid)) {
        throw new ReliabilityError('assertion', 'CrowdSec managed child PID was invalid')
    }
    return pid
}

async function signalEngine(
    context: ReliabilityContext,
    pid: string,
    signal: 'SIGSTOP' | 'SIGCONT' | 'SIGTERM',
): Promise<void> {
    await context.docker([
        'exec',
        context.container,
        'bun',
        '--no-env-file',
        '-e',
        'process.kill(Number(process.argv[1]), process.argv[2])',
        pid,
        signal,
    ])
}

async function decision(context: ReliabilityContext, operation: 'add' | 'delete', ip: string) {
    await context.docker([
        'exec',
        context.container,
        'gosu',
        'crowdsec',
        'cscli',
        '-c',
        '/usr/share/rentnerproxy/crowdsec/config.yaml',
        'decisions',
        operation,
        '--ip',
        ip,
        ...(operation === 'add'
            ? ['--duration', '2m', '--reason', 'rentnerproxy-runtime-reliability']
            : []),
    ])
}

async function verifyDecisionCount(context: ReliabilityContext, ip: string): Promise<void> {
    const value: unknown = JSON.parse(
        await context.docker([
            'exec',
            context.container,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'list',
            '--ip',
            ip,
            '--output',
            'json',
        ]),
    )
    if (!Array.isArray(value) || value.length !== 1) {
        throw new ReliabilityError('assertion', 'CrowdSec fixture alert count was not bounded')
    }
    const decisions = record(value[0]).decisions
    if (!Array.isArray(decisions) || decisions.length !== 1) {
        throw new ReliabilityError('assertion', 'CrowdSec fixture decision count was not bounded')
    }
    const ownDecision = record(decisions[0])
    if (ownDecision.value !== ip || ownDecision.scope !== 'Ip' || ownDecision.type !== 'ban') {
        throw new ReliabilityError('assertion', 'CrowdSec fixture decision targeted another IP')
    }
}

async function ready(context: ReliabilityContext): Promise<void> {
    await context.waitFor(
        async () => {
            const status = await managedStatus(context)
            return status.state === 'connected' && status.managedEngine === 'ready'
        },
        'managed CrowdSec did not become connected',
        90_000,
    )
}

async function assertEnforcement(context: ReliabilityContext, ip: string): Promise<void> {
    await decision(context, 'add', ip)
    await verifyDecisionCount(context, ip)
    await context.waitFor(
        async () => (await context.http()).status === 403,
        'managed CrowdSec ban did not reach real proxy traffic',
        45_000,
    )
    await decision(context, 'delete', ip)
    await context.waitFor(
        async () => (await context.http()).status === 200,
        'managed CrowdSec removal did not restore real proxy traffic',
        45_000,
    )
}

export async function exerciseCrowdSec(context: ReliabilityContext): Promise<void> {
    let clientIp: string | undefined
    let pausedPid: string | undefined
    try {
        await context.synced(await context.fixture('crowdsec-update'))
        await ready(context)
        const baseline = await context.http()
        assert.equal(baseline.status, 200)
        clientIp = privateClientIp(baseline.body.forwardedFor)
        await decision(context, 'delete', clientIp)
        await assertEnforcement(context, clientIp)
        context.check(
            'proxy',
            'real managed CrowdSec ban and removal enforce only the fixture client',
        )

        const restartsBefore = await supervisorRestarts(context)
        pausedPid = await enginePid(context)
        await signalEngine(context, pausedPid, 'SIGSTOP')
        await context.waitFor(
            async () => (await managedStatus(context)).state === 'degraded',
            'paused managed CrowdSec did not report degraded',
            30_000,
        )
        assert.equal((await context.http()).status, 200)
        context.check(
            'proxy',
            'real managed CrowdSec outage follows its configured fail-open behavior',
        )
        await signalEngine(context, pausedPid, 'SIGCONT')
        const stoppedPid = pausedPid
        pausedPid = undefined
        await signalEngine(context, stoppedPid, 'SIGTERM')
        await context.waitFor(
            async () => (await supervisorRestarts(context)) > restartsBefore,
            'managed CrowdSec supervisor did not record a child restart',
            45_000,
        )
        await ready(context)
        const restartDelta = (await supervisorRestarts(context)) - restartsBefore
        assert.ok(
            restartDelta >= 1 && restartDelta <= 2,
            'CrowdSec restart storm after injected crash',
        )
        await assertEnforcement(context, clientIp)
        context.check(
            'restart',
            'real managed CrowdSec supervisor recovers and enforces decisions again',
        )
    } finally {
        try {
            if (pausedPid) await signalEngine(context, pausedPid, 'SIGCONT')
            if (clientIp) await decision(context, 'delete', clientIp)
        } finally {
            await context.synced(await context.fixture('crowdsec-disable'))
        }
    }
}

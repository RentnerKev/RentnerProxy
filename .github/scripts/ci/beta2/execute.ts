import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { createBeta2Receivers } from './receivers.ts'
import { startBeta2Controller } from './controller-process.ts'
import { beta2Directory, validateBeta2Environment } from './run.ts'
import type { Beta2WebContext } from './Types/journeys.types.ts'

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            server.close((error) => {
                if (error || !address || typeof address === 'string')
                    reject(error ?? new Error('no port'))
                else resolve(address.port)
            })
        })
    })
}

async function execute() {
    validateBeta2Environment(process.env)
    const runId = process.env.RENTNERPROXY_BETA2_RUN_ID ?? ''
    const directory = beta2Directory(runId)
    assert.equal(process.env.RENTNERPROXY_BETA2_DIRECTORY, directory)
    const certPath = join(directory, 'smtp-cert.pem')
    const keyPath = join(directory, 'smtp-key.pem')
    assert.equal(process.env.RENTNERPROXY_BETA2_SMTP_CERT, certPath)
    assert.equal(process.env.RENTNERPROXY_BETA2_SMTP_KEY, keyPath)
    const [cert, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')])
    const receivers = createBeta2Receivers({ smtpTls: { cert, key } })
    let controller: Awaited<ReturnType<typeof startBeta2Controller>> | undefined
    let context: Beta2WebContext | undefined
    let starting: ReturnType<typeof startBeta2Controller> | undefined
    const abort = new AbortController()
    let cleanup: Promise<void> | undefined
    async function close() {
        cleanup ??= (async () => {
            await starting?.catch(() => undefined)
            try {
                await context?.close()
            } finally {
                try {
                    await controller?.close()
                } finally {
                    await receivers.stop()
                }
            }
        })()
        await cleanup
    }
    const interrupted = () => {
        abort.abort()
        void close().finally(() => process.exit(1))
    }
    process.once('SIGTERM', interrupted)
    process.once('SIGINT', interrupted)
    try {
        const [httpPort, httpsPort] = await Promise.all([freePort(), freePort()])
        const configuration = {
            runId,
            directory,
            providerUrl: receivers.providerUrl,
            ipv4Url: receivers.ipv4Url,
            ipv6Url: receivers.ipv6Url,
            httpPort,
            httpsPort,
        }
        starting = startBeta2Controller(configuration, abort.signal)
        controller = await starting
        assert.ok(receivers.smtpPort)
        Object.assign(process.env, {
            APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
            SMTP_FROM: 'Beta 2 fixture <fixture@beta2.invalid>',
            SMTP_HOST: '127.0.0.1',
            SMTP_PORT: String(receivers.smtpPort),
            SMTP_SECURE: 'false',
            RENTNERPROXY_CONTROLLER_URL: controller.url,
            RENTNERPROXY_CONTROLLER_TOKEN: runId,
            RENTNERPROXY_BETA2_INTEGRATION: runId,
        })
        delete process.env.SMTP_USER
        delete process.env.SMTP_PASSWORD
        delete process.env.SMTP_PASSWORD_FILE
        delete process.env.APP_ENCRYPTION_KEY_FILE
        delete process.env.RENTNERPROXY_CONTROLLER_TOKEN_FILE
        const { createBeta2WebContext } = await import('./web-context.ts')
        const { runBeta2Journeys } = await import('./journeys.ts')
        context = await createBeta2WebContext(runId)
        const result = await runBeta2Journeys({
            receivers,
            context,
            httpPort,
            stateDirectory: join(directory, 'controller'),
            async restartController() {
                await controller!.close()
                controller = undefined
                starting = startBeta2Controller(configuration, abort.signal)
                controller = await starting
                process.env.RENTNERPROXY_CONTROLLER_URL = controller.url
            },
        })
        console.log(JSON.stringify({ beta2: 'passed', ...result }))
    } finally {
        process.removeListener('SIGTERM', interrupted)
        process.removeListener('SIGINT', interrupted)
        await close()
    }
}

if (import.meta.main) await execute()

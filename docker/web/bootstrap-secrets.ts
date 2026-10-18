// oxlint-disable no-await-in-loop -- Secret materialization retries a bounded compare-and-swap sequence.

import { randomBytes, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
    BootstrapSecretName,
    BootstrapSecretState,
    PendingAppKeyRestore,
    ProductionRestoreJournal,
} from './Types/bootstrap-secrets.types.ts'

const maximumSecretBytes = 4_096
const stateDirectory = '/var/lib/rentnerproxy/bootstrap'
const statePath = join(stateDirectory, 'secrets-v1.json')
const pendingAppKeyRestorePath = join(stateDirectory, 'app-key-restore-v1.json')
const productionRestorePath = join(stateDirectory, 'production-restore-v1.json')
const postgresDataDirectory = '/var/lib/rentnerproxy/postgres-data'
const backupAppKeyPath = '/backup/app-encryption-key'
const restoreAppKeyPath = '/restore-key/app-encryption-key'
const outputPaths: Record<BootstrapSecretName, string> = {
    appEncryptionKey: '/run/rentnerproxy/app-key/value',
    controllerToken: '/run/rentnerproxy/controller-token/value',
    databaseUrl: '/run/rentnerproxy/database-url/value',
    postgresPassword: '/run/rentnerproxy/postgres/value',
}

function configuredDatabaseHost(): 'postgres' | '127.0.0.1' {
    const value = (process.env.RENTNERPROXY_DATABASE_HOST ?? 'postgres').trim()
    if (value !== 'postgres' && value !== '127.0.0.1') {
        throw new Error('Configured database host is invalid.')
    }
    return value
}

function validateAppEncryptionKey(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^[A-Za-z0-9+/]{43}=$/u.test(value) &&
        Buffer.from(value, 'base64').byteLength === 32 &&
        Buffer.from(value, 'base64').toString('base64') === value
    )
}

function decodeUrlPassword(url: URL): string | null {
    try {
        return decodeURIComponent(url.password)
    } catch {
        return null
    }
}

function validatePostgresPassword(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.trim() === value &&
        Buffer.byteLength(value, 'utf8') <= 1_024 &&
        !/[\0\r\n]/u.test(value)
    )
}

function validateDatabaseUrl(value: unknown, postgresPassword: string): value is string {
    if (
        typeof value !== 'string' ||
        Buffer.byteLength(value, 'utf8') > maximumSecretBytes ||
        value.trim() !== value
    ) {
        return false
    }

    try {
        const url = new URL(value)
        return (
            (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
            url.hostname === configuredDatabaseHost() &&
            (url.port === '' || url.port === '5432') &&
            url.username === 'rentnerproxy' &&
            url.pathname === '/rentnerproxy' &&
            !url.search &&
            !url.hash &&
            decodeUrlPassword(url) === postgresPassword
        )
    } catch {
        return false
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateState(value: unknown): value is BootstrapSecretState {
    if (!isRecord(value)) return false
    const keys = Object.keys(value).toSorted()
    if (
        keys.join(',') !== 'appEncryptionKey,controllerToken,databaseUrl,postgresPassword,version'
    ) {
        return false
    }
    return (
        value.version === 1 &&
        validatePostgresPassword(value.postgresPassword) &&
        validateDatabaseUrl(value.databaseUrl, value.postgresPassword) &&
        validateAppEncryptionKey(value.appEncryptionKey) &&
        typeof value.controllerToken === 'string' &&
        /^[A-Za-z0-9_-]{32,256}$/u.test(value.controllerToken)
    )
}

function validatePendingAppKeyRestore(value: unknown): value is PendingAppKeyRestore {
    if (!isRecord(value)) return false
    const keys = Object.keys(value).toSorted()
    return (
        keys.join(',') === 'nextAppEncryptionKey,previousAppEncryptionKey,version' &&
        value.version === 1 &&
        validateAppEncryptionKey(value.previousAppEncryptionKey) &&
        validateAppEncryptionKey(value.nextAppEncryptionKey)
    )
}

async function readRegularFile(path: string, maximumBytes = maximumSecretBytes): Promise<string> {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumBytes) {
        throw new Error('invalid persistent runtime secret file')
    }
    const bytes = await readFile(path)
    if (bytes.byteLength > maximumBytes || bytes.includes(0)) {
        throw new Error('invalid persistent runtime secret file')
    }
    return bytes.toString('utf8').trim()
}

async function readOptionalRegularFile(
    path: string,
    maximumBytes = maximumSecretBytes,
): Promise<string | null> {
    try {
        return await readRegularFile(path, maximumBytes)
    } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') return null
        throw error
    }
}

async function readState(): Promise<BootstrapSecretState | null> {
    const contents = await readOptionalRegularFile(statePath)
    if (contents === null) return null

    try {
        const state: unknown = JSON.parse(contents)
        if (!validateState(state)) throw new Error('invalid state')
        return state
    } catch {
        throw new Error('Persistent runtime secret state is invalid.')
    }
}

async function readPendingAppKeyRestore(): Promise<PendingAppKeyRestore | null> {
    const contents = await readOptionalRegularFile(pendingAppKeyRestorePath)
    if (contents === null) return null

    try {
        const pendingRestore: unknown = JSON.parse(contents)
        if (!validatePendingAppKeyRestore(pendingRestore))
            throw new Error('invalid pending restore')
        return pendingRestore
    } catch {
        throw new Error('Pending application encryption key restore state is invalid.')
    }
}

async function ensureNoPendingAppKeyRestore(): Promise<void> {
    if ((await readPendingAppKeyRestore()) !== null) {
        throw new Error('An application encryption key restore is pending.')
    }
}

async function readProductionRestore(): Promise<ProductionRestoreJournal | null> {
    const contents = await readOptionalRegularFile(productionRestorePath)
    if (contents === null) return null
    try {
        const value: unknown = JSON.parse(contents)
        if (
            !isRecord(value) ||
            value.version !== 1 ||
            Object.keys(value).toSorted().join(',') !== 'backupId,version' ||
            typeof value.backupId !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(value.backupId)
        )
            throw new Error('invalid journal')
        return { backupId: value.backupId, version: 1 }
    } catch {
        throw new Error('Pending production restore journal is invalid.')
    }
}

async function ensureNoProductionRestore(): Promise<void> {
    if (await readProductionRestore())
        throw new Error('An interrupted production restore requires --resume with the same backup.')
}

async function beginProductionRestore(): Promise<void> {
    const backupId = process.env.RENTNERPROXY_RESTORE_BACKUP_ID
    if (typeof backupId !== 'string' || !/^[a-f0-9]{64}$/u.test(backupId))
        throw new Error('Invalid restore backup identity.')
    const pending = await readProductionRestore()
    if (pending) {
        if (process.env.RENTNERPROXY_RESTORE_RESUME !== 'true' || pending.backupId !== backupId) {
            throw new Error('Pending production restore requires the same backup and --resume.')
        }
        return
    }
    if (process.env.RENTNERPROXY_RESTORE_RESUME === 'true')
        throw new Error('No production restore is pending.')
    const journal: ProductionRestoreJournal = { backupId, version: 1 }
    await writeAtomic(productionRestorePath, JSON.stringify(journal), 0o400, false, true)
}

async function completeProductionRestore(): Promise<void> {
    const pending = await readProductionRestore()
    if (!pending || pending.backupId !== process.env.RENTNERPROXY_RESTORE_BACKUP_ID)
        throw new Error('Pending production restore identity mismatch.')
    await ensureNoPendingAppKeyRestore()
    await rm(productionRestorePath)
    await syncDirectory(stateDirectory)
}

async function syncDirectory(directory: string): Promise<void> {
    if (process.platform === 'win32') return
    const handle = await open(directory, 'r')
    try {
        await handle.sync()
    } finally {
        await handle.close()
    }
}

async function writeAtomic(
    path: string,
    value: string,
    mode: number,
    replace: boolean,
    exclusive = false,
): Promise<void> {
    const directory = dirname(path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = join(directory, `.bootstrap-${randomUUID()}`)

    try {
        const handle = await open(temporaryPath, 'wx', mode)
        try {
            await handle.writeFile(value, 'utf8')
            await handle.chmod(mode)
            await handle.sync()
        } finally {
            await handle.close()
        }
        if (exclusive) {
            await link(temporaryPath, path)
        } else {
            if (!replace && (await readOptionalRegularFile(path)) !== null) {
                throw new Error('destination already exists')
            }
            await rename(temporaryPath, path)
        }
        await syncDirectory(directory)
    } finally {
        await rm(temporaryPath, { force: true })
    }
}

async function persistNewState(
    generatedState: BootstrapSecretState,
): Promise<BootstrapSecretState> {
    try {
        await writeAtomic(statePath, JSON.stringify(generatedState), 0o400, false, true)
        return generatedState
    } catch {
        const concurrentState = await readState()
        if (!concurrentState) throw new Error('Persistent runtime secret state could not be saved.')
        return concurrentState
    }
}

async function hasEntries(path: string): Promise<boolean> {
    try {
        return (await readdir(path)).length > 0
    } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') return false
        throw error
    }
}

export async function hasMaterializedSecrets(
    paths: readonly string[] = Object.values(outputPaths),
): Promise<boolean> {
    const values = await Promise.all(paths.map((path) => readOptionalRegularFile(path)))
    return values.some((value) => value !== null)
}

export function assertInitialSecretGenerationAllowed(
    existingDatabase: boolean,
    materializedSecrets: boolean,
): void {
    if (existingDatabase || materializedSecrets) {
        throw new Error(
            'Persistent runtime secret state secrets-v1.json is missing for an existing installation. Start from a supported beta.1 installation with its persisted secret state, or restore a supported v4 backup; legacy environment secret import is no longer supported.',
        )
    }
}

function generateState(): BootstrapSecretState {
    const postgresPassword = randomBytes(32).toString('hex')
    const databaseHost = configuredDatabaseHost()
    return {
        appEncryptionKey: randomBytes(32).toString('base64'),
        controllerToken: randomBytes(32).toString('hex'),
        databaseUrl: `postgresql://rentnerproxy:${postgresPassword}@${databaseHost}:5432/rentnerproxy`,
        postgresPassword,
        version: 1,
    }
}

async function materializeSecrets(state: BootstrapSecretState): Promise<void> {
    await Promise.all(
        Object.keys(outputPaths)
            .filter((name): name is BootstrapSecretName => name in outputPaths)
            .map(async (name) => {
                const path = outputPaths[name]
                const expected = state[name]
                if ((await readOptionalRegularFile(path)) === expected) return
                await writeAtomic(path, expected, 0o444, true)
            }),
    )
}

async function materializeCurrentState(
    initialState: BootstrapSecretState,
): Promise<BootstrapSecretState> {
    let desiredState = initialState
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await materializeSecrets(desiredState)
        const persistedState = await readState()
        if (!persistedState) throw new Error('Persistent runtime secret state is missing.')
        if (JSON.stringify(persistedState) === JSON.stringify(desiredState)) return persistedState
        desiredState = persistedState
    }
    throw new Error('Persistent runtime secret state changed too frequently.')
}

async function initializeSecrets(): Promise<void> {
    await ensureNoProductionRestore()
    await ensureNoPendingAppKeyRestore()
    let state = await readState()
    if (!state) {
        const existingDatabase = await hasEntries(postgresDataDirectory)
        assertInitialSecretGenerationAllowed(existingDatabase, await hasMaterializedSecrets())
        state = await persistNewState(generateState())
        console.log('Persistent runtime secrets were generated.')
    } else {
        console.log('Persistent runtime secrets are ready.')
    }
    await materializeCurrentState(state)
    await ensureNoPendingAppKeyRestore()
}

async function exportAppEncryptionKey(): Promise<void> {
    await ensureNoProductionRestore()
    await ensureNoPendingAppKeyRestore()
    const state = await readState()
    if (!state) throw new Error('Persistent runtime secret state is missing.')
    await writeAtomic(backupAppKeyPath, state.appEncryptionKey, 0o400, false)
    console.log('Application encryption key was added to the backup.')
}

async function rollbackPendingAppKeyRestore(pendingRestore: PendingAppKeyRestore): Promise<void> {
    const state = await readState()
    if (!state) throw new Error('Persistent runtime secret state is missing.')
    const rolledBackState = {
        ...state,
        appEncryptionKey: pendingRestore.previousAppEncryptionKey,
    }
    await writeAtomic(statePath, JSON.stringify(rolledBackState), 0o400, true)
    await materializeCurrentState(rolledBackState)
    await rm(pendingAppKeyRestorePath)
    await syncDirectory(stateDirectory)
}

async function beginAppEncryptionKeyRestore(): Promise<void> {
    const nextAppEncryptionKey = await readRegularFile(restoreAppKeyPath)
    if (!validateAppEncryptionKey(nextAppEncryptionKey)) {
        throw new Error('Backup application encryption key is invalid.')
    }
    const state = await readState()
    if (!state) throw new Error('Persistent runtime secret state is missing.')
    const existing = await readPendingAppKeyRestore()
    if (existing) {
        if (
            !(await readProductionRestore()) ||
            existing.nextAppEncryptionKey !== nextAppEncryptionKey
        )
            throw new Error('Pending application key restore mismatch.')
        const resumedState = { ...state, appEncryptionKey: nextAppEncryptionKey }
        await writeAtomic(statePath, JSON.stringify(resumedState), 0o400, true)
        await materializeCurrentState(resumedState)
        return
    }
    const pendingRestore: PendingAppKeyRestore = {
        nextAppEncryptionKey,
        previousAppEncryptionKey: state.appEncryptionKey,
        version: 1,
    }
    await writeAtomic(pendingAppKeyRestorePath, JSON.stringify(pendingRestore), 0o400, false, true)

    try {
        const updatedState = { ...state, appEncryptionKey: nextAppEncryptionKey }
        await writeAtomic(statePath, JSON.stringify(updatedState), 0o400, true)
        await materializeCurrentState(updatedState)
    } catch {
        try {
            await rollbackPendingAppKeyRestore(pendingRestore)
        } catch {
            throw new Error('Application encryption key restore staging and rollback failed.')
        }
        throw new Error('Application encryption key restore could not be staged.')
    }
    console.log('Application encryption key restore was staged.')
}

async function completeAppEncryptionKeyRestore(): Promise<void> {
    const pendingRestore = await readPendingAppKeyRestore()
    if (!pendingRestore) throw new Error('No application encryption key restore is pending.')
    const state = await readState()
    if (!state || state.appEncryptionKey !== pendingRestore.nextAppEncryptionKey) {
        throw new Error('Pending application encryption key restore is inconsistent.')
    }
    await materializeCurrentState(state)
    await rm(pendingAppKeyRestorePath)
    await syncDirectory(stateDirectory)
    console.log('Application encryption key restore was completed.')
}

async function rollbackAppEncryptionKeyRestore(): Promise<void> {
    const pendingRestore = await readPendingAppKeyRestore()
    if (!pendingRestore) throw new Error('No application encryption key restore is pending.')
    await rollbackPendingAppKeyRestore(pendingRestore)
    console.log('Application encryption key restore was rolled back.')
}

if (import.meta.main) {
    try {
        const operation = process.argv[2] ?? 'initialize'
        if (operation === 'initialize') await initializeSecrets()
        else if (operation === 'export-app-key') await exportAppEncryptionKey()
        else if (operation === 'inspect-production-restore')
            console.log((await readProductionRestore())?.backupId ?? '')
        else if (operation === 'begin-production-restore') await beginProductionRestore()
        else if (operation === 'complete-production-restore') await completeProductionRestore()
        else if (operation === 'begin-app-key-restore') await beginAppEncryptionKeyRestore()
        else if (operation === 'complete-app-key-restore') await completeAppEncryptionKeyRestore()
        else if (operation === 'rollback-app-key-restore') await rollbackAppEncryptionKeyRestore()
        else throw new Error('Unknown runtime secret bootstrap operation.')
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown bootstrap failure'
        console.error(`Runtime secret bootstrap failed: ${message}`)
        process.exitCode = 1
    }
}

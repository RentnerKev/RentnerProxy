// oxlint-disable no-await-in-loop -- Secret materialization retries a bounded compare-and-swap sequence.

import { randomBytes, randomUUID } from 'node:crypto'
import {
    chmod,
    link,
    lstat,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const maximumSecretBytes = 4_096
const maximumLegacyEnvironmentBytes = 65_536
const stateDirectory = '/var/lib/rentnerproxy/bootstrap'
const statePath = join(stateDirectory, 'secrets-v1.json')
const pendingAppKeyRestorePath = join(stateDirectory, 'app-key-restore-v1.json')
const postgresDataDirectory = '/var/lib/rentnerproxy/postgres-data'
const legacyEnvironmentPath = '/var/lib/rentnerproxy/legacy-source/.env'
const backupAppKeyPath = '/backup/app-encryption-key'
const restoreAppKeyPath = '/restore-key/app-encryption-key'
const legacyEnvironmentLoadedVariable = 'RENTNERPROXY_BOOTSTRAP_LEGACY_ENV_LOADED'
const scriptPath = fileURLToPath(import.meta.url)
const outputPaths = {
    appEncryptionKey: '/run/rentnerproxy/app-key/value',
    controllerToken: '/run/rentnerproxy/controller-token/value',
    databaseUrl: '/run/rentnerproxy/database-url/value',
    postgresPassword: '/run/rentnerproxy/postgres/value',
}

function configuredDatabaseHost() {
    const value = (process.env.RENTNERPROXY_DATABASE_HOST ?? 'postgres').trim()
    if (value !== 'postgres' && value !== '127.0.0.1') {
        throw new Error('Configured database host is invalid.')
    }
    return value
}

function validateAppEncryptionKey(value) {
    return (
        typeof value === 'string' &&
        /^[A-Za-z0-9+/]{43}=$/u.test(value) &&
        Buffer.from(value, 'base64').byteLength === 32 &&
        Buffer.from(value, 'base64').toString('base64') === value
    )
}

function decodeUrlPassword(url) {
    try {
        return decodeURIComponent(url.password)
    } catch {
        return null
    }
}

function validatePostgresPassword(value) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.trim() === value &&
        Buffer.byteLength(value, 'utf8') <= 1_024 &&
        !/[\0\r\n]/u.test(value)
    )
}

function validateDatabaseUrl(value, postgresPassword) {
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

function validateState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
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

function validatePendingAppKeyRestore(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const keys = Object.keys(value).toSorted()
    return (
        keys.join(',') === 'nextAppEncryptionKey,previousAppEncryptionKey,version' &&
        value.version === 1 &&
        validateAppEncryptionKey(value.previousAppEncryptionKey) &&
        validateAppEncryptionKey(value.nextAppEncryptionKey)
    )
}

async function readRegularFile(path, maximumBytes = maximumSecretBytes) {
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

async function readOptionalRegularFile(path, maximumBytes = maximumSecretBytes) {
    try {
        return await readRegularFile(path, maximumBytes)
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return null
        throw error
    }
}

async function readState() {
    const contents = await readOptionalRegularFile(statePath)
    if (contents === null) return null

    try {
        const state = JSON.parse(contents)
        if (!validateState(state)) throw new Error('invalid state')
        return state
    } catch {
        throw new Error('Persistent runtime secret state is invalid.')
    }
}

async function readPendingAppKeyRestore() {
    const contents = await readOptionalRegularFile(pendingAppKeyRestorePath)
    if (contents === null) return null

    try {
        const pendingRestore = JSON.parse(contents)
        if (!validatePendingAppKeyRestore(pendingRestore))
            throw new Error('invalid pending restore')
        return pendingRestore
    } catch {
        throw new Error('Pending application encryption key restore state is invalid.')
    }
}

async function ensureNoPendingAppKeyRestore() {
    if ((await readPendingAppKeyRestore()) !== null) {
        throw new Error('An application encryption key restore is pending.')
    }
}

async function writeAtomic(path, value, mode, replace, exclusive = false) {
    const directory = dirname(path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = join(directory, `.bootstrap-${randomUUID()}`)

    try {
        await writeFile(temporaryPath, value, { encoding: 'utf8', flag: 'wx', mode })
        await chmod(temporaryPath, mode)
        if (exclusive) {
            await link(temporaryPath, path)
        } else {
            if (!replace && (await readOptionalRegularFile(path)) !== null) {
                throw new Error('destination already exists')
            }
            await rename(temporaryPath, path)
        }
    } finally {
        await rm(temporaryPath, { force: true })
    }
}

async function persistNewState(generatedState) {
    try {
        await writeAtomic(statePath, JSON.stringify(generatedState), 0o400, false, true)
        return generatedState
    } catch {
        const concurrentState = await readState()
        if (!concurrentState) throw new Error('Persistent runtime secret state could not be saved.')
        return concurrentState
    }
}

async function hasEntries(path) {
    try {
        return (await readdir(path)).length > 0
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return false
        throw error
    }
}

async function hasMaterializedSecrets() {
    const values = await Promise.all(Object.values(outputPaths).map(readOptionalRegularFile))
    return values.some((value) => value !== null)
}

async function hasLegacyEnvironmentFile() {
    try {
        const metadata = await lstat(legacyEnvironmentPath)
        return (
            metadata.isFile() &&
            !metadata.isSymbolicLink() &&
            metadata.size > 0 &&
            metadata.size <= maximumLegacyEnvironmentBytes
        )
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return false
        throw error
    }
}

async function reexecuteWithLegacyEnvironment() {
    if (
        process.env[legacyEnvironmentLoadedVariable] === '1' ||
        !(await hasLegacyEnvironmentFile())
    ) {
        return false
    }

    const child = Bun.spawn({
        cmd: [
            process.execPath,
            '--no-env-file',
            `--env-file=${legacyEnvironmentPath}`,
            scriptPath,
            ...process.argv.slice(2),
        ],
        env: {
            ...process.env,
            [legacyEnvironmentLoadedVariable]: '1',
        },
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
    })
    process.exit(await child.exited)
}

function generateState() {
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

function legacyStateFromEnvironment() {
    const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''
    let url
    try {
        url = new URL(databaseUrl)
    } catch {
        throw new Error('Existing installation secrets in .env are invalid.')
    }
    const postgresPassword = decodeUrlPassword(url)
    const explicitPostgresPassword = process.env.POSTGRES_PASSWORD
    const appEncryptionKey = process.env.APP_ENCRYPTION_KEY?.trim() ?? ''
    const configuredControllerToken = process.env.RENTNERPROXY_CONTROLLER_TOKEN?.trim() ?? ''
    const controllerToken =
        configuredControllerToken === ''
            ? randomBytes(32).toString('hex')
            : configuredControllerToken
    const state = {
        appEncryptionKey,
        controllerToken,
        databaseUrl,
        postgresPassword,
        version: 1,
    }

    if (
        !validateState(state) ||
        (explicitPostgresPassword !== undefined &&
            explicitPostgresPassword !== '' &&
            explicitPostgresPassword !== postgresPassword)
    ) {
        throw new Error('Existing installation secrets in .env are invalid.')
    }
    return state
}

async function materializeSecrets(state) {
    await Promise.all(
        Object.entries(outputPaths).map(async ([name, path]) => {
            const expected = state[name]
            if ((await readOptionalRegularFile(path)) === expected) return
            await writeAtomic(path, expected, 0o444, true)
        }),
    )
}

async function materializeCurrentState(initialState) {
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

async function initializeSecrets() {
    await ensureNoPendingAppKeyRestore()
    let state = await readState()
    if (!state) {
        const existingDatabase = await hasEntries(postgresDataDirectory)
        if (await hasMaterializedSecrets()) {
            throw new Error(
                'Persistent runtime secret state is missing for an existing installation.',
            )
        }
        if (existingDatabase) {
            if (process.env[legacyEnvironmentLoadedVariable] !== '1') {
                if (await reexecuteWithLegacyEnvironment()) return
                throw new Error(
                    'Existing installation secrets could not be imported from the local .env file.',
                )
            }
            state = await persistNewState(legacyStateFromEnvironment())
            console.log('Persistent runtime secrets were imported from the existing installation.')
        } else {
            state = await persistNewState(generateState())
            console.log('Persistent runtime secrets were generated.')
        }
    } else {
        console.log('Persistent runtime secrets are ready.')
    }
    await materializeCurrentState(state)
    await ensureNoPendingAppKeyRestore()
}

async function exportAppEncryptionKey() {
    await ensureNoPendingAppKeyRestore()
    const state = await readState()
    if (!state) throw new Error('Persistent runtime secret state is missing.')
    await writeAtomic(backupAppKeyPath, state.appEncryptionKey, 0o400, false)
    console.log('Application encryption key was added to the backup.')
}

async function rollbackPendingAppKeyRestore(pendingRestore) {
    const state = await readState()
    if (!state) throw new Error('Persistent runtime secret state is missing.')
    const rolledBackState = {
        ...state,
        appEncryptionKey: pendingRestore.previousAppEncryptionKey,
    }
    await writeAtomic(statePath, JSON.stringify(rolledBackState), 0o400, true)
    await materializeCurrentState(rolledBackState)
    await rm(pendingAppKeyRestorePath)
}

async function beginAppEncryptionKeyRestore() {
    await ensureNoPendingAppKeyRestore()
    const nextAppEncryptionKey = await readRegularFile(restoreAppKeyPath)
    if (!validateAppEncryptionKey(nextAppEncryptionKey)) {
        throw new Error('Backup application encryption key is invalid.')
    }
    const state = await readState()
    if (!state) throw new Error('Persistent runtime secret state is missing.')
    const pendingRestore = {
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

async function completeAppEncryptionKeyRestore() {
    const pendingRestore = await readPendingAppKeyRestore()
    if (!pendingRestore) throw new Error('No application encryption key restore is pending.')
    const state = await readState()
    if (!state || state.appEncryptionKey !== pendingRestore.nextAppEncryptionKey) {
        throw new Error('Pending application encryption key restore is inconsistent.')
    }
    await materializeCurrentState(state)
    await rm(pendingAppKeyRestorePath)
    console.log('Application encryption key restore was completed.')
}

async function rollbackAppEncryptionKeyRestore() {
    const pendingRestore = await readPendingAppKeyRestore()
    if (!pendingRestore) throw new Error('No application encryption key restore is pending.')
    await rollbackPendingAppKeyRestore(pendingRestore)
    console.log('Application encryption key restore was rolled back.')
}

try {
    const operation = process.argv[2] ?? 'initialize'
    if (operation === 'initialize') await initializeSecrets()
    else if (operation === 'export-app-key') await exportAppEncryptionKey()
    else if (operation === 'begin-app-key-restore') await beginAppEncryptionKeyRestore()
    else if (operation === 'complete-app-key-restore') await completeAppEncryptionKeyRestore()
    else if (operation === 'rollback-app-key-restore') await rollbackAppEncryptionKeyRestore()
    else throw new Error('Unknown runtime secret bootstrap operation.')
} catch (error) {
    const message = error instanceof Error ? error.message : 'unknown bootstrap failure'
    console.error(`Runtime secret bootstrap failed: ${message}`)
    process.exitCode = 1
}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { StoredCrowdSecConfiguration } from '../server/Admin/CrowdSec/crowdsec-settings'

const originalEncryptionKey = process.env.APP_ENCRYPTION_KEY
const encryptionKeyA = Buffer.from(new Uint8Array(32).fill(21)).toString('base64')
const encryptionKeyB = Buffer.from(new Uint8Array(32).fill(22)).toString('base64')
const externalApiKey = 'external-bouncer-key-value'

beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = encryptionKeyA
})

afterEach(() => {
    if (originalEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY
    else process.env.APP_ENCRYPTION_KEY = originalEncryptionKey
})

const {
    DEFAULT_CROWDSEC_CONFIGURATION,
    buildStoredCrowdSecConfiguration,
    crowdSecControllerRequestFromStored,
    normalizeCrowdSecApiUrl,
} = await import('../server/Admin/CrowdSec/crowdsec-settings')

describe('CrowdSec persisted configuration', () => {
    test('normalizes endpoints without changing an explicit base path', () => {
        expect(normalizeCrowdSecApiUrl('https://crowdsec.example.test:8080')).toBe(
            'https://crowdsec.example.test:8080/',
        )
        expect(normalizeCrowdSecApiUrl('https://crowdsec.example.test/lapi')).toBe(
            'https://crowdsec.example.test/lapi/',
        )
    })

    test('encrypts external credentials and never serializes plaintext', async () => {
        const stored = await buildStoredCrowdSecConfiguration(DEFAULT_CROWDSEC_CONFIGURATION, {
            mode: 'external',
            apiUrl: 'https://crowdsec.example.test:8080',
            apiKey: externalApiKey,
        })

        expect(stored).toMatchObject({
            version: 1,
            mode: 'external',
            external: { apiUrl: 'https://crowdsec.example.test:8080/' },
        })
        expect(JSON.stringify(stored)).not.toContain(externalApiKey)
        expect(stored.external?.apiKey.ciphertext).not.toBeEmpty()
        expect(stored.external?.apiKey.iv).not.toBeEmpty()
        expect(await crowdSecControllerRequestFromStored(stored)).toEqual({
            mode: 'external',
            apiUrl: 'https://crowdsec.example.test:8080/',
            apiKey: externalApiKey,
        })
    })

    test('retains an external provider while disabled and supports key replacement', async () => {
        const external = await buildStoredCrowdSecConfiguration(DEFAULT_CROWDSEC_CONFIGURATION, {
            mode: 'external',
            apiUrl: 'https://crowdsec.example.test/',
            apiKey: externalApiKey,
        })
        const disabled = await buildStoredCrowdSecConfiguration(external, {
            mode: 'disabled',
        })
        const restored = await buildStoredCrowdSecConfiguration(disabled, {
            mode: 'external',
            apiUrl: 'https://crowdsec.example.test/',
        })
        const replaced = await buildStoredCrowdSecConfiguration(restored, {
            mode: 'external',
            apiUrl: 'https://crowdsec.example.test/',
            apiKey: 'replacement-bouncer-key',
        })

        expect(disabled.mode).toBe('disabled')
        expect(disabled.external).toEqual(external.external)
        expect(await crowdSecControllerRequestFromStored(restored)).toMatchObject({
            apiKey: externalApiKey,
        })
        expect(await crowdSecControllerRequestFromStored(replaced)).toMatchObject({
            apiKey: 'replacement-bouncer-key',
        })
    })

    test('requires a first external key and fails closed after key rotation', async () => {
        await expect(
            buildStoredCrowdSecConfiguration(DEFAULT_CROWDSEC_CONFIGURATION, {
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test/',
            }),
        ).rejects.toMatchObject({ code: 'api_key_required' })

        const stored: StoredCrowdSecConfiguration = await buildStoredCrowdSecConfiguration(
            DEFAULT_CROWDSEC_CONFIGURATION,
            {
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test/',
                apiKey: externalApiKey,
            },
        )
        process.env.APP_ENCRYPTION_KEY = encryptionKeyB
        await expect(crowdSecControllerRequestFromStored(stored)).rejects.toMatchObject({
            code: 'configuration_unavailable',
        })
    })
})

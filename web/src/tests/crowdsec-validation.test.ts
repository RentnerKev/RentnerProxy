import { describe, expect, test } from 'bun:test'

import { CROWDSEC_API_KEY_MAX_LENGTH, CROWDSEC_API_KEY_MIN_LENGTH } from '../config/crowdsec.config'
import {
    crowdSecApiKeySchema,
    crowdSecApiUrlSchema,
    testCrowdSecConnectionSchema,
    updateCrowdSecConfigurationSchema,
} from '../features/Admin/CrowdSec/validation'

describe('CrowdSec configuration validation', () => {
    test('accepts exactly the three supported mode payloads', () => {
        expect(updateCrowdSecConfigurationSchema.parse({ mode: 'disabled' })).toEqual({
            mode: 'disabled',
        })
        expect(updateCrowdSecConfigurationSchema.parse({ mode: 'managed' })).toEqual({
            mode: 'managed',
        })
        expect(
            updateCrowdSecConfigurationSchema.parse({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test:8080/v1/',
                apiKey: 'A'.repeat(CROWDSEC_API_KEY_MIN_LENGTH),
            }),
        ).toMatchObject({ mode: 'external' })

        expect(updateCrowdSecConfigurationSchema.safeParse({ mode: 'other' }).success).toBeFalse()
        expect(
            updateCrowdSecConfigurationSchema.safeParse({
                mode: 'disabled',
                apiUrl: 'https://crowdsec.example.test/',
            }).success,
        ).toBeFalse()
        expect(
            updateCrowdSecConfigurationSchema.safeParse({ mode: 'external' }).success,
        ).toBeFalse()
    })

    test.each([
        'ftp://crowdsec.example.test',
        'https://user:password@crowdsec.example.test',
        'https://crowdsec.example.test/?token=secret',
        'https://crowdsec.example.test/#fragment',
        ' https://crowdsec.example.test',
        'https://crowdsec.example.test\n',
        'not-a-url',
    ])('rejects unsafe external endpoint %s', (apiUrl) => {
        expect(crowdSecApiUrlSchema.safeParse(apiUrl).success).toBeFalse()
    })

    test('bounds API keys to printable non-whitespace ASCII', () => {
        expect(
            crowdSecApiKeySchema.safeParse('A'.repeat(CROWDSEC_API_KEY_MIN_LENGTH)).success,
        ).toBeTrue()
        expect(
            crowdSecApiKeySchema.safeParse('A'.repeat(CROWDSEC_API_KEY_MIN_LENGTH - 1)).success,
        ).toBeFalse()
        expect(
            crowdSecApiKeySchema.safeParse('A'.repeat(CROWDSEC_API_KEY_MAX_LENGTH + 1)).success,
        ).toBeFalse()
        expect(crowdSecApiKeySchema.safeParse('not valid because spaces').success).toBeFalse()
        expect(crowdSecApiKeySchema.safeParse('A'.repeat(16) + '\n').success).toBeFalse()
        expect(crowdSecApiKeySchema.safeParse('A'.repeat(16) + 'ü').success).toBeFalse()
    })

    test('allows connection tests to reuse an existing write-only key', () => {
        expect(
            testCrowdSecConnectionSchema.safeParse({
                apiUrl: 'http://crowdsec.internal:8080/',
            }).success,
        ).toBeTrue()
    })
})

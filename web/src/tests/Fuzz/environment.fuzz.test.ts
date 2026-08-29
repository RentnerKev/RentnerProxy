import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { parseAppUrl } from '../../server/env.server'

const FUZZ_RUNS = 100

const hostLabelArbitrary = fc.stringMatching(/^[a-z][a-z0-9]{0,23}$/)
const httpsOriginArbitrary = fc
    .tuple(hostLabelArbitrary, fc.option(fc.integer({ min: 1, max: 65_535 }), { nil: undefined }))
    .map(
        ([hostLabel, port]) =>
            'https://' + hostLabel + '.example' + (port === undefined ? '' : ':' + String(port)),
    )
const unsafeAppUrlArbitrary = httpsOriginArbitrary.chain((origin) => {
    const host = new URL(origin).host

    return fc.constantFrom(
        'http://' + host,
        origin + '/path',
        origin + '/?query=value',
        origin + '/#fragment',
        'https://user:secret@' + host,
        'https://trusted.example@' + host,
        'ftp://' + host,
        'javascript:alert(1)',
        'data:text/plain,not-an-origin',
    )
})

function restoreNodeEnvironment(originalNodeEnvironment: string | undefined): void {
    if (originalNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
    } else {
        process.env.NODE_ENV = originalNodeEnvironment
    }
}

describe('environment property fuzzing', () => {
    test('canonicalizes arbitrary valid HTTPS application origins', () => {
        const originalNodeEnvironment = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'

        try {
            fc.assert(
                fc.property(httpsOriginArbitrary, (origin) => {
                    expect(parseAppUrl(' ' + origin + '/ ')).toBe(new URL(origin).origin)
                }),
                { numRuns: FUZZ_RUNS },
            )
        } finally {
            restoreNodeEnvironment(originalNodeEnvironment)
        }
    })

    test('rejects arbitrary application URL smuggling variants', () => {
        const originalNodeEnvironment = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'

        try {
            fc.assert(
                fc.property(unsafeAppUrlArbitrary, (value) => {
                    expect(parseAppUrl(value)).toBeNull()
                }),
                { numRuns: FUZZ_RUNS },
            )
        } finally {
            restoreNodeEnvironment(originalNodeEnvironment)
        }
    })
})

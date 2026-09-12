import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { parsePublicOrigin } from '../../server/env.server'

const FUZZ_RUNS = 100

const hostLabelArbitrary = fc.stringMatching(/^[a-z][a-z0-9]{0,23}$/)
const httpsOriginArbitrary = fc
    .tuple(hostLabelArbitrary, fc.option(fc.integer({ min: 1, max: 65_535 }), { nil: undefined }))
    .map(
        ([hostLabel, port]) =>
            'https://' + hostLabel + '.example' + (port === undefined ? '' : ':' + String(port)),
    )
const unsafePublicOriginArbitrary = httpsOriginArbitrary.chain((origin) => {
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

describe('environment property fuzzing', () => {
    test('canonicalizes arbitrary valid HTTPS public origins', () => {
        fc.assert(
            fc.property(httpsOriginArbitrary, (origin) => {
                expect(parsePublicOrigin(' ' + origin + '/ ', 'production')).toBe(
                    new URL(origin).origin,
                )
            }),
            { numRuns: FUZZ_RUNS },
        )
    })

    test('rejects arbitrary public origin smuggling variants', () => {
        fc.assert(
            fc.property(unsafePublicOriginArbitrary, (value) => {
                expect(parsePublicOrigin(value, 'production')).toBeNull()
            }),
            { numRuns: FUZZ_RUNS },
        )
    })
})

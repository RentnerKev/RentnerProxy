import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import {
    createPasswordResetEmailTemplate,
    createUserInviteEmailTemplate,
    escapeMailHtml,
} from '../../server/Mail/templates'

const FUZZ_RUNS = 100
const MAIL_APP_URL = 'https://mail.rentnerproxy.example:8443/base?ignored=true#old'
const MAIL_APP_ORIGIN = new URL(MAIL_APP_URL).origin

const hostileTextArbitrary = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 96 }),
    fc
        .array(
            fc.constantFrom(
                '<',
                '>',
                '&',
                '"',
                "'",
                '\u0060',
                '=',
                '?',
                '#',
                '/',
                '\\',
                '\r',
                '\n',
                'ä',
                '😀',
            ),
            { maxLength: 96 },
        )
        .map((characters) => characters.join('')),
)
const tokenArbitrary = fc.string({ unit: 'binary', minLength: 1, maxLength: 128 })
const mailTemplateArbitrary = fc.constantFrom(
    {
        create: createPasswordResetEmailTemplate,
        path: '/reset-password',
    } as const,
    {
        create: createUserInviteEmailTemplate,
        path: '/accept-invite',
    } as const,
)

describe('mail template property fuzzing', () => {
    test('keeps arbitrary content escaped and action links same-origin', () => {
        fc.assert(
            fc.property(
                mailTemplateArbitrary,
                hostileTextArbitrary,
                tokenArbitrary,
                ({ create, path }, displayName, token) => {
                    const template = create({
                        appUrl: MAIL_APP_URL,
                        displayName,
                        token,
                    })
                    const textActionUrls = template.text.match(/https?:\/\/[^\s]+/g) ?? []

                    expect(textActionUrls).toHaveLength(1)

                    const actionUrl = new URL(textActionUrls[0] ?? '')
                    const tokenParameter = new URLSearchParams(actionUrl.hash.slice(1)).get('token')
                    const escapedInput = escapeMailHtml(displayName)
                    const unrecognizedAmpersands = escapedInput.replace(
                        /&(amp|lt|gt|quot|#039);/g,
                        '',
                    )
                    const greeting = displayName.trim()
                        ? 'Hallo ' + displayName.trim() + ','
                        : 'Hallo,'

                    expect(actionUrl.origin).toBe(MAIL_APP_ORIGIN)
                    expect(actionUrl.pathname).toBe(path)
                    expect(actionUrl.search).toBe('')
                    expect(tokenParameter).toBe(token)
                    expect(template.html).toContain(escapeMailHtml(greeting))
                    expect(template.html).not.toMatch(/<(script|img|iframe|link)\b/i)
                    expect(unrecognizedAmpersands).not.toMatch(/[&<>"']/)
                },
            ),
            { numRuns: FUZZ_RUNS },
        )
    })
})

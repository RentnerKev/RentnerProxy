import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ClientIpCountry from '../features/Admin/ProxyAccessLogs/Components/ClientIpCountry'
import withTestLanguage from './Helpers/withTestLanguage'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'

const entry = {
    timestamp: '2026-09-13T12:00:00Z',
    host: 'example.com',
    method: 'GET',
    path: '/',
    status: 200,
    durationMs: 1,
    clientIp: '8.8.8.8',
    upstream: null,
    bytes: 0,
    protocol: 'HTTP/2',
}

describe('client IP country display', () => {
    test('keeps the address and locally rendered flag together with a localized country name', () => {
        const html = renderToStaticMarkup(
            withTestLanguage(
                <TooltipProvider>
                    <ClientIpCountry entry={{ ...entry, countryCode: 'US' }} />
                </TooltipProvider>,
                'de',
            ),
        )
        expect(html).toContain('8.8.8.8')
        expect(html).toContain('whitespace-nowrap')
        expect(html).toContain('flag:US')
        expect(html).toContain('Vereinigte Staaten')
        expect(html).not.toContain('http')
    })

    test('shows just the IP for unknown or invalid country codes', () => {
        for (const countryCode of [null, '', '../us', 'USA', 'ZZ']) {
            const html = renderToStaticMarkup(
                withTestLanguage(
                    <TooltipProvider>
                        <ClientIpCountry entry={{ ...entry, countryCode }} />
                    </TooltipProvider>,
                ),
            )
            expect(html).toContain(entry.clientIp)
            expect(html).not.toContain('flag:')
        }
    })
})

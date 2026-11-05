import { afterEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { getManagedDomainHref } = await import('@/lib/Domain/managedDomain.ts')
const { ProxyHostDomainsCell } =
    await import('@/features/Admin/ProxyHostManagement/Components/ProxyHostsTable/Components/ProxyHostTableCells.tsx')
const { CertificateDomainsCell } =
    await import('@/features/Admin/CertificateManagement/Components/CertificatesTable/Components/CertificateTableCells.tsx')
const { RedirectHostDomainsCell } =
    await import('@/features/Admin/RedirectHostManagement/Components/RedirectHostsTable/Components/RedirectHostTableCells.tsx')

let root: Root | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(withTestLanguage(<TooltipProvider>{element}</TooltipProvider>))
    })
    return container
}

afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

describe('managed domain links', () => {
    test('creates HTTPS URLs only for concrete managed domains', () => {
        expect(getManagedDomainHref('app.example.com')).toBe('https://app.example.com')
        expect(getManagedDomainHref('APP.EXAMPLE.COM')).toBe('https://app.example.com')
        expect(getManagedDomainHref('*.example.com')).toBeNull()
        expect(getManagedDomainHref('app.example.com/path')).toBeNull()
        expect(getManagedDomainHref('https://app.example.com')).toBeNull()
        expect(getManagedDomainHref('APP.EXAMPLE.COM', 'http')).toBe('http://app.example.com')
        for (const scheme of ['http', 'https'] as const) {
            for (const domain of [
                '*.example.com',
                'app.example.com/path',
                'user@app.example.com',
                'app.example.com:8080',
                'app.example.com?query',
                'app.example.com#hash',
                'app.example.com\\path',
            ]) {
                expect(getManagedDomainHref(domain, scheme)).toBeNull()
            }
        }
    })

    for (const [HostDomainsCell, kind] of [
        [ProxyHostDomainsCell, 'proxy'],
        [RedirectHostDomainsCell, 'redirect'],
    ] as const) {
        for (const certificateId of [null, 'configured-certificate']) {
            test(`${kind} uses the configured TLS scheme for visible and overflow domains (${certificateId})`, async () => {
                const domains = ['first.example.com', 'second.example.com', 'overflow.example.com']
                const scheme = certificateId ? 'https' : 'http'
                const container = await render(
                    <HostDomainsCell domains={domains} certificateId={certificateId} />,
                )
                expect(
                    [...container.querySelectorAll('a')].map((link) => link.getAttribute('href')),
                ).toEqual(domains.slice(0, 2).map((domain) => `${scheme}://${domain}`))
                await act(async () => container.querySelector<HTMLButtonElement>('button')?.click())
                expect(document.querySelector(`a[href="${scheme}://${domains[2]}"]`)).not.toBeNull()
            })
        }
    }

    test('links proxy, certificate, and redirect domains safely without bubbling row actions', async () => {
        const rowClick = mock(() => {})
        const rowKeyDown = mock(() => {})
        const container = await render(
            <table>
                <tbody>
                    <tr onClick={rowClick} onKeyDown={rowKeyDown}>
                        <td>
                            <ProxyHostDomainsCell domains={['proxy.example.com']} />
                            <CertificateDomainsCell
                                domains={[
                                    'cert.example.com',
                                    'www.cert.example.com',
                                    'api.cert.example.com',
                                ]}
                            />
                            <CertificateDomainsCell
                                domains={['mixed.example.com', '*.example.com']}
                            />
                            <RedirectHostDomainsCell domains={['redirect.example.com']} />
                        </td>
                    </tr>
                </tbody>
            </table>,
        )

        const expectedDomains = [
            'proxy.example.com',
            'cert.example.com',
            'www.cert.example.com',
            'mixed.example.com',
            'redirect.example.com',
        ]
        const links = [...container.querySelectorAll<HTMLAnchorElement>('a')]
        expect(links.map((link) => link.textContent)).toEqual(expectedDomains)
        for (const [index, link] of links.entries()) {
            const domain = expectedDomains[index]!
            expect(link.getAttribute('href')).toBe(`https://${domain}`)
            expect(link.target).toBe('_blank')
            expect(link.rel).toBe('noopener noreferrer')
            expect(link.getAttribute('aria-label')).toBe(`Open ${domain} in a new tab`)
        }
        expect(
            [...container.querySelectorAll('a')].some(
                (link) => link.textContent === '*.example.com',
            ),
        ).toBeFalse()
        expect(container.textContent).toContain('*.example.com')

        const overflow = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Show 1 more domains"]',
        )
        expect(overflow).not.toBeNull()
        await act(async () => overflow?.click())
        const overflowLink = document.querySelector<HTMLAnchorElement>(
            'a[href="https://api.cert.example.com"]',
        )
        expect(overflowLink?.target).toBe('_blank')
        expect(overflowLink?.rel).toBe('noopener noreferrer')

        await act(async () => {
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
            clickEvent.preventDefault()
            links[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
            links[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
            links[0]?.dispatchEvent(clickEvent)
        })
        expect(rowClick).not.toHaveBeenCalled()
        expect(rowKeyDown).not.toHaveBeenCalled()
    })
})

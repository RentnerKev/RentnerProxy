import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import CrowdSecOriginChart from '../features/Admin/CrowdSec/Components/CrowdSecOriginChart'
import CrowdSecDecisionChart from '../features/Admin/CrowdSec/Components/CrowdSecDecisionChart'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

let root: Root | null = null

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

test('renders CrowdSec origin counts with TanStack Charts and an accessible label', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <CrowdSecOriginChart
                    rows={[
                        { origin: 'crowdsec', count: 12 },
                        { origin: 'CAPI', count: 3 },
                    ]}
                    label="Blocked requests by origin"
                    color="var(--color-brand-500)"
                />,
            ),
        )
    })
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('crowdsec')
    expect(container.innerHTML).toContain('focus-visible')
})

test('renders a zero-valued column chart instead of an empty plot', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <CrowdSecOriginChart
                    rows={[
                        { origin: 'crowdsec', count: 0 },
                        { origin: 'CAPI', count: 0 },
                    ]}
                    label="Blocked requests by origin"
                    color="var(--color-brand-500)"
                />,
            ),
        )
    })
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('crowdsec')
    expect(container.textContent).toContain('CAPI')
})

test('renders a separate donut composition with compact and exact totals', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <CrowdSecDecisionChart
                    rows={[
                        { origin: 'CAPI', count: 15_004 },
                        { origin: 'crowdsec', count: 7 },
                    ]}
                    label="Active decisions by origin"
                />,
            ),
        )
    })
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('path')).not.toBeNull()
    expect(container.textContent).toContain('15k')
    expect(container.innerHTML).toContain('15,011')
    expect(container.innerHTML).toContain('focus-visible')
})

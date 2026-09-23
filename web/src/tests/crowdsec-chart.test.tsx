import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import CrowdSecOriginChart from '../features/Admin/CrowdSec/Components/CrowdSecOriginChart'

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
            <CrowdSecOriginChart
                rows={[
                    { origin: 'crowdsec', count: 12 },
                    { origin: 'CAPI', count: 3 },
                ]}
                label="Blocked requests by origin"
                color="var(--color-brand-500)"
            />,
        )
    })
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('crowdsec')
})

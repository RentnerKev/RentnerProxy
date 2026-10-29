import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { MonitoringChecksTableProps } from '@/features/Admin/HostMonitoring/Components/MonitoringChecksTable/Types/checks-table.types.ts'
import type { HostMonitoringObservationView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MonitoringChecksTable } =
    await import('@/features/Admin/HostMonitoring/Components/MonitoringChecksTable/index.tsx')

let root: Root | undefined
const observations = Array.from({ length: 25 }, (_, index): HostMonitoringObservationView => ({
    id: `check-${index}`,
    policyId: 'policy',
    policyVersion: 'version',
    checkedAt: new Date(Date.parse('2026-10-29T12:00:00Z') - index * 60_000),
    status: index % 3 === 0 ? 'healthy' : index % 3 === 1 ? 'unhealthy' : 'unknown',
    code:
        index % 3 === 0
            ? 'expected_status'
            : index % 3 === 1
              ? 'unexpected_status'
              : 'runtime_unavailable',
    durationMs: index % 3 === 2 ? null : index * 10,
    httpStatus: index % 3 === 0 ? 200 : index % 3 === 1 ? 503 : null,
})).toReversed()
const defaults: MonitoringChecksTableProps = {
    observations,
    more: false,
    loadingMore: false,
    onLoadMore: () => undefined,
}

async function render(props: MonitoringChecksTableProps = defaults) {
    if (!root) {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
    }
    await act(async () => root!.render(withTestLanguage(<MonitoringChecksTable {...props} />)))
}
async function click(element: Element | null | undefined) {
    expect(element).toBeTruthy()
    await act(async () => {
        element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`)
const dataRows = () =>
    [...document.querySelectorAll('tbody tr')].filter((row) => row.querySelector('time'))
async function choose(label: string, text: string) {
    if (byLabel(label)?.closest('[hidden]')) await click(byLabel('Filters'))
    await click(byLabel(label))
    const option = [...document.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent?.trim() === text,
    )
    expect(option).toBeTruthy()
    await act(async () => {
        option!.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        option!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
async function search(value: string) {
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            input,
            value,
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 350))
    })
}
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
})

test('recent checks use shared pagination, page sizes and newest-first sorting', async () => {
    await render()
    expect(dataRows()).toHaveLength(10)
    expect(dataRows()[0]?.querySelector('time')?.dateTime).toBe('2026-10-29T12:00:00.000Z')
    expect(document.body.textContent).toContain('Page 1 of 3')
    expect(document.body.textContent).toContain('of 25 checks')
    await click(byLabel('Go to next page'))
    expect(document.body.textContent).toContain('Page 2 of 3')
    expect(dataRows()[0]?.querySelector('time')?.dateTime).toBe('2026-10-29T11:50:00.000Z')
    await click(byLabel('Go to last page'))
    expect(dataRows()).toHaveLength(5)
    await choose('Rows per page', '20')
    expect(document.body.textContent).toContain('Page 1 of 2')
    expect(dataRows()).toHaveLength(20)
    expect(document.querySelector('tbody')?.textContent).toContain('0 ms')
})

test('HTTP search resets pagination and shows a filtered empty state without losing the query', async () => {
    await render()
    await click(byLabel('Go to next page'))
    await search('503')
    expect(dataRows()).toHaveLength(8)
    expect(dataRows().every((row) => row.textContent?.includes('Unhealthy'))).toBe(true)
    expect(document.body.textContent).toContain('Page 1 of 1')
    await search('no-matching-check')
    expect(dataRows()).toHaveLength(0)
    expect(document.body.textContent).toContain('No matching checks')
    expect(document.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe(
        'no-matching-check',
    )
})

test('shared status, HTTP and outcome filters match exactly, including missing responses', async () => {
    await render()
    await choose('All statuses', 'Healthy')
    expect(dataRows()).toHaveLength(9)
    expect(dataRows().some((row) => row.textContent?.includes('Unhealthy'))).toBe(false)
    await choose('All HTTP statuses', '503')
    expect(dataRows()).toHaveLength(0)
    await click(
        [...document.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Reset filters',
        ),
    )
    await choose('All HTTP statuses', 'No HTTP response')
    expect(dataRows()).toHaveLength(8)
    expect(dataRows().every((row) => row.textContent?.includes('Unknown'))).toBe(true)
    await choose('All outcomes', 'Proxy runtime unavailable')
    expect(dataRows()).toHaveLength(8)
})

test('polling and loading older checks preserve the current page and column filters', async () => {
    let loadCalls = 0
    const onLoadMore = () => {
        loadCalls += 1
    }
    await render({ ...defaults, more: true, onLoadMore })
    await click(byLabel('Go to next page'))
    await render({
        ...defaults,
        observations: structuredClone(observations),
        more: true,
        onLoadMore,
    })
    expect(document.body.textContent).toContain('Page 2 of 3')
    await click(
        [...document.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Load older checks',
        ),
    )
    expect(loadCalls).toBe(1)
    await render({
        ...defaults,
        observations: [
            ...observations,
            { ...observations[0]!, id: 'older', checkedAt: new Date('2026-10-28T10:00:00Z') },
        ],
    })
    expect(document.body.textContent).toContain('Page 2 of 3')
    expect(document.body.textContent).toContain('26 checks loaded')
    await choose('All statuses', 'Healthy')
    await render({ ...defaults, observations: structuredClone(observations) })
    expect(dataRows()).toHaveLength(9)
    expect(document.body.textContent).toContain('Page 1 of 1')
})

test('numeric duration sorting preserves measured zeroes and keeps missing values last', async () => {
    await render()
    await click(byLabel('Sort by durationMs'))
    if (byLabel('Sort by durationMs')?.closest('th')?.getAttribute('aria-sort') !== 'ascending') {
        await click(byLabel('Sort by durationMs'))
    }
    expect(dataRows()[0]?.children[2]?.textContent).toBe('0 ms')
    await click(byLabel('Go to last page'))
    expect(dataRows().every((row) => row.children[2]?.textContent === '—')).toBe(true)
})

test('empty history uses the shared empty state and older-page loading is guarded', async () => {
    await render({ ...defaults, observations: [], more: true, loadingMore: true })
    expect(document.body.textContent).toContain('No checks have been recorded yet.')
    const load = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Load older checks',
    )
    expect(load?.disabled).toBe(true)
    expect(
        document.querySelector<HTMLButtonElement>('[aria-label="Go to next page"]')?.disabled,
    ).toBe(true)
})

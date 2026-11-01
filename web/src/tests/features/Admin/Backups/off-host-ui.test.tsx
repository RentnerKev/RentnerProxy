import { afterEach, describe, expect, test, spyOn } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type {
    OffHostConfigurationInput,
    OffHostStatus,
} from '@/lib/Backups/Types/off-host.types.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: OffHostBackup } =
    await import('@/features/Admin/Backups/Components/OffHostBackup.tsx')
const configuration: OffHostStatus = {
    revision: 3,
    enabled: true,
    endpoint: 'https://storage.example.test',
    region: 'test-1',
    bucket: 'backups',
    prefix: '',
    configured: true,
    targetId: '01900000-0000-7000-8000-000000000001',
    keyId: 'a'.repeat(64),
    retainedCopies: 2,
}
let root: Root | null = null
let requests: OffHostConfigurationInput[] = []
let failSave = false
async function render(config = configuration, locked = false) {
    if (!root) {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
    }
    await act(async () =>
        root?.render(
            withTestLanguage(
                <OffHostBackup
                    configuration={config}
                    locked={locked}
                    onSave={async (configurationInput) => {
                        requests.push(configurationInput)
                        if (failSave) throw new Error('simulated transport failure')
                        return {
                            offHost: { ...config, revision: config.revision + 1 },
                        } as ManagedBackupStatus
                    }}
                />,
            ),
        ),
    )
}
function button(label: string) {
    const result = [...document.querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === label,
    )
    if (!result) throw new Error('Missing button: ' + label)
    return result
}
async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
}
async function input(name: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
    if (!element) throw new Error('Missing field')
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            element,
            value,
        )
        element.dispatchEvent(new Event('input', { bubbles: true }))
    })
}
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.innerHTML = ''
    requests = []
    failSave = false
})
describe('off-host backup configuration', () => {
    test('confirms generation and reveals only the new key, masking replacements and clearing on reset', async () => {
        await render()
        expect(document.querySelector('input[name="recoveryKey"]')).toBeNull()
        expect(button('Download recovery kit').disabled).toBeTrue()

        await click(button('Generate new recovery key'))
        const first = document.querySelector<HTMLInputElement>('input[name="recoveryKey"]')!
        expect(first.readOnly).toBeTrue()
        expect(first.type).toBe('password')
        expect(atob(first.value)).toHaveLength(32)
        expect(document.querySelector('output')?.textContent).toContain('Recovery key generated')
        expect(button('Download recovery kit').disabled).toBeFalse()
        await click(document.querySelector(`button[aria-controls="${first.id}"]`)!)
        expect(first.type).toBe('text')

        await click(button('Generate new recovery key'))
        const replacement = document.querySelector<HTMLInputElement>('input[name="recoveryKey"]')!
        expect(replacement.value).not.toBe(first.value)
        expect(replacement.type).toBe('password')
        expect(replacement.readOnly).toBeTrue()

        await click(button('Load current settings'))
        expect(document.querySelector('input[name="recoveryKey"]')).toBeNull()
        expect(document.querySelector('output')).toBeNull()
        expect(button('Download recovery kit').disabled).toBeTrue()
    })

    test('preserves stored secrets by omitting blank credentials and keys from an edit', async () => {
        await render()
        expect(
            document.querySelector<HTMLInputElement>('input[name="secretAccessKey"]')?.value,
        ).toBe('')
        expect(document.querySelector<HTMLInputElement>('input[name="accessKeyId"]')?.value).toBe(
            '',
        )
        await input('prefix', 'daily')
        await click(button('Save off-host settings'))
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({ prefix: 'daily', expectedRevision: 3 })
        expect(requests[0]).not.toHaveProperty('recoveryKey')
        expect(requests[0]).not.toHaveProperty('secretAccessKey')
        expect(requests[0]).not.toHaveProperty('accessKeyId')
    })
    test('requires a downloaded recovery kit and explicit saved acknowledgement for a new key', async () => {
        const blobs: Blob[] = []
        const create = spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            blobs.push(blob as Blob)
            return 'blob:test-recovery'
        })
        const anchor = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        try {
            await render()
            await click(button('Generate new recovery key'))
            expect(button('Save off-host settings').disabled).toBeTrue()
            const checkbox = document.querySelector<HTMLInputElement>(
                'input[name="recoveryKeySaved"]',
            )!
            expect(checkbox.disabled).toBeTrue()
            await click(button('Download recovery kit'))
            const kit = JSON.parse(await blobs[0]!.text()) as {
                format: string
                version: number
                recoveryKey: string
            }
            expect(kit.format).toBe('rentnerproxy-off-host-recovery-key')
            expect(kit.version).toBe(1)
            expect(atob(kit.recoveryKey)).toHaveLength(32)
            expect(
                document.querySelector<HTMLInputElement>('input[name="recoveryKey"]')?.value,
            ).toBe(kit.recoveryKey)
            expect(document.body.textContent).not.toContain(kit.recoveryKey)
            expect(button('Save off-host settings').disabled).toBeTrue()
            await click(checkbox)
            await click(button('Save off-host settings'))
            expect(requests[0]?.recoveryKey).toBe(kit.recoveryKey)
            expect(requests[0]?.recoveryKeySaved).toBeTrue()
            expect(document.querySelector('input[name="recoveryKey"]')).toBeNull()
        } finally {
            create.mockRestore()
            anchor.mockRestore()
        }
    })
    test('retains a generated key and request identity after a failed save', async () => {
        const blobs: Blob[] = []
        const create = spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            blobs.push(blob as Blob)
            return 'blob:test-retry'
        })
        const anchor = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        try {
            await render()
            await click(button('Generate new recovery key'))
            await click(button('Download recovery kit'))
            await click(document.querySelector('input[name="recoveryKeySaved"]')!)
            failSave = true
            await click(button('Save off-host settings'))
            expect(requests).toHaveLength(1)
            expect(button('Save off-host settings').disabled).toBeFalse()
            failSave = false
            await click(button('Save off-host settings'))
            expect(requests).toHaveLength(2)
            expect(requests[1]).toEqual(requests[0])
            const kit = JSON.parse(await blobs[0]!.text()) as { recoveryKey: string }
            expect(requests[1]?.recoveryKey).toBe(kit.recoveryKey)
        } finally {
            create.mockRestore()
            anchor.mockRestore()
        }
    })
    test('rejects stale edits until reset and respects the parent lock', async () => {
        await render()
        await input('prefix', 'stale')
        await render({ ...configuration, revision: 4 })
        expect(button('Save off-host settings').disabled).toBeTrue()
        await click(button('Load current settings'))
        await render(configuration, true)
        expect(button('Generate new recovery key').disabled).toBeTrue()
        expect(button('Save off-host settings').disabled).toBeTrue()
        expect(requests).toHaveLength(0)
    })
})

import { expect, test } from 'bun:test'
import { createCertificateMetadataSnapshotReader } from '@/server/Admin/CertificateManagement/certificate-metadata-snapshot.ts'

test('concurrent callers share the exact pre-GET capture and metadata, then the next call reads fresh', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const order: string[] = []
    let captures = 0
    let requests = 0
    const read = createCertificateMetadataSnapshotReader({
        capture: async () => {
            order.push('capture')
            captures++
            return [{ id: 'certificate', xmin: String(captures) }]
        },
        readMetadata: async () => {
            order.push('GET')
            requests++
            entered.resolve()
            await release.promise
            return []
        },
    })
    const first = read()
    await entered.promise
    const joined = read()
    expect(joined).toBe(first)
    release.resolve()
    const [snapshot, shared] = await Promise.all([first, joined])
    expect(shared).toBe(snapshot)
    expect(snapshot.validBeforeRead).toEqual([{ id: 'certificate', xmin: '1' }])
    expect(captures).toBe(1)
    expect(requests).toBe(1)
    expect(order).toEqual(['capture', 'GET'])
    const next = await read()
    expect(next).not.toBe(snapshot)
    expect(next.validBeforeRead[0]?.xmin).toBe('2')
    expect(requests).toBe(2)
})

test.each(['capture', 'GET'] as const)(
    'a rejected %s clears the flight for a fresh retry',
    async (failure) => {
        let reject = true
        let captures = 0
        let requests = 0
        const read = createCertificateMetadataSnapshotReader({
            capture: async () => {
                captures++
                if (reject && failure === 'capture') throw new Error('capture')
                return []
            },
            readMetadata: async () => {
                requests++
                if (reject) throw new Error('GET')
                return []
            },
        })
        const first = read()
        const joined = read()
        expect(joined).toBe(first)
        const results = await Promise.allSettled([first, joined])
        expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
        expect(captures).toBe(1)
        expect(requests).toBe(failure === 'capture' ? 0 : 1)
        reject = false
        expect(await read()).toEqual({ validBeforeRead: [], metadata: [] })
        expect(captures).toBe(2)
        expect(requests).toBe(failure === 'capture' ? 1 : 2)
    },
)

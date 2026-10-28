import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createGeoReader } from '@/server/Admin/CrowdSec/crowdsec-geoip.server.ts'

const database = Buffer.from(
    'AAABAAAjAAASAAACAAAAAAAAAAAAAAAAAAAAAOFMY291bnRyeV9jb2RlQkRF4Udjb3VudHJ54Uhpc29fY29kZUJOTKvN701heE1pbmQuY29t6VtiaW5hcnlfZm9ybWF0X21ham9yX3ZlcnNpb26hAltiaW5hcnlfZm9ybWF0X21pbm9yX3ZlcnNpb26hAEtidWlsZF9lcG9jaAECAE1kYXRhYmFzZV90eXBlTFRlc3QtQ291bnRyeUtkZXNjcmlwdGlvbuFCZW5VVGVzdCBjb3VudHJ5IGRhdGFiYXNlSmlwX3ZlcnNpb26hBklsYW5ndWFnZXMBBEJlbkpub2RlX2NvdW50wQJLcmVjb3JkX3NpemWhGA==',
    'base64',
)

test('reads IPv4 and IPv6 records with the real parser and retains the loaded snapshot', async () => {
    const parent = join(process.cwd(), 'tmp')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'country-reader-'))
    const path = join(directory, 'country.mmdb')
    try {
        await writeFile(path, database)
        const load = createGeoReader(() => path)
        const [first, concurrent] = await Promise.all([load(), load()])
        expect(first).not.toBeNull()
        expect(concurrent).toBe(first)
        expect(first?.get('203.0.113.120')).toEqual({ country_code: 'DE' })
        expect(first?.get('2001:db8::1')).toEqual({ country_code: 'DE' })
        expect(first?.get('8000::1')).toEqual({ country: { iso_code: 'NL' } })
        expect(first?.get('4000::1')).toBeNull()
        await writeFile(path, 'invalid replacement')
        expect(await load()).toBe(first)
        expect(first?.get('203.0.113.120')).toEqual({ country_code: 'DE' })
    } finally {
        await unlink(path)
        await rmdir(directory)
    }
})

test('recovers after a missing or corrupt database is replaced with a valid file', async () => {
    const parent = join(process.cwd(), 'tmp')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'country-retry-'))
    const path = join(directory, 'country.mmdb')
    try {
        const load = createGeoReader(() => path)
        expect(await load()).toBeNull()
        await writeFile(path, 'invalid database')
        expect(await load()).toBeNull()
        await writeFile(path, database)
        expect((await load())?.get('203.0.113.120')).toEqual({ country_code: 'DE' })
    } finally {
        await unlink(path)
        await rmdir(directory)
    }
})

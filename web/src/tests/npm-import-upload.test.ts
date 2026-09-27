import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'bun:test'

import { NPM_IMPORT_MAX_BYTES, NpmSourceError } from '../server/Admin/NpmImport/npm-source'
import { withNpmSqliteUpload } from '../server/Admin/NpmImport/npm-temp'

describe('NPM SQLite upload', () => {
    test('streams the exact bytes and removes the private temp file after success', async () => {
        const payload = Uint8Array.from({ length: 256 }, (_, index) => index)
        const request = new Request('http://localhost/api/npm-import', {
            method: 'POST',
            body: payload,
        })
        let path = ''
        const result = await withNpmSqliteUpload(request, async (sourcePath, fingerprint) => {
            path = sourcePath
            expect(new Uint8Array(await readFile(sourcePath))).toEqual(payload)
            return fingerprint
        })
        expect(result).toBe(createHash('sha256').update(payload).digest('hex'))
        expect(existsSync(path)).toBe(false)
    })

    test('removes the temp file when source processing fails', async () => {
        const request = new Request('http://localhost/api/npm-import', {
            method: 'POST',
            body: new Uint8Array(128),
        })
        let path = ''
        await expect(
            withNpmSqliteUpload(request, (sourcePath) => {
                path = sourcePath
                throw new Error('processing failed')
            }),
        ).rejects.toThrow('processing failed')
        expect(existsSync(path)).toBe(false)
    })

    test('rejects an advertised oversized body before opening a temp file', async () => {
        const request = new Request('http://localhost/api/npm-import', {
            method: 'POST',
            headers: { 'content-length': String(NPM_IMPORT_MAX_BYTES + 1) },
            body: new Uint8Array(128),
        })
        await expect(withNpmSqliteUpload(request, () => Promise.resolve(true))).rejects.toEqual(
            new NpmSourceError('source_limit'),
        )
    })
})

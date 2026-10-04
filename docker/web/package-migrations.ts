// oxlint-disable no-await-in-loop -- Package journal entries in their declared order.
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

async function readRegularFile(path: string): Promise<Buffer> {
    const info = await lstat(path)
    if (!info.isFile()) throw new Error('Migration packaging requires regular files.')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        if (!(await file.stat()).isFile())
            throw new Error('Migration packaging requires regular files.')
        return await file.readFile()
    } finally {
        await file.close()
    }
}

function lfBytes(bytes: Buffer): Buffer {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (/\r(?!\n)/u.test(text)) throw new Error('Unsupported migration line endings.')
    // Preserve every other byte: never trim SQL, reserialize JSON, or rewrite history hashes.
    return Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8')
}

function containsPath(parent: string, child: string): boolean {
    const difference = relative(parent, child)
    return (
        difference === '' ||
        (difference !== '..' && !difference.startsWith('..' + sep) && !isAbsolute(difference))
    )
}

export async function packageMigrations(source: string, destination: string): Promise<void> {
    const input = resolve(source)
    for (const directory of [input, join(input, 'meta')]) {
        if (!(await lstat(directory)).isDirectory())
            throw new Error('Migration packaging requires regular directories.')
    }
    const resolvedInput = await realpath(input)
    const requestedOutput = resolve(destination)
    const output = join(await realpath(dirname(requestedOutput)), basename(requestedOutput))
    if (containsPath(resolvedInput, output) || containsPath(output, resolvedInput))
        throw new Error('Migration packaging requires separate source and output directories.')

    const journalBytes = lfBytes(await readRegularFile(join(input, 'meta', '_journal.json')))
    const journal: unknown = JSON.parse(journalBytes.toString('utf8'))
    if (
        typeof journal !== 'object' ||
        journal === null ||
        !('entries' in journal) ||
        !Array.isArray(journal.entries) ||
        journal.entries.length === 0
    )
        throw new Error('Invalid migration packaging journal.')

    const files = new Map<string, Buffer>([['meta/_journal.json', journalBytes]])
    for (const entry of journal.entries) {
        if (
            typeof entry !== 'object' ||
            entry === null ||
            !('tag' in entry) ||
            typeof entry.tag !== 'string' ||
            !/^[0-9]{4}_[a-z0-9_]+$/u.test(entry.tag) ||
            files.has(entry.tag + '.sql')
        )
            throw new Error('Invalid migration packaging journal entry.')
        const name = entry.tag + '.sql'
        files.set(name, lfBytes(await readRegularFile(join(input, name))))
    }

    // A fresh build output prevents partial/stale files from entering the runtime image.
    await mkdir(output)
    await mkdir(join(output, 'meta'))
    for (const [name, bytes] of files) {
        await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o644 })
    }
}

if (import.meta.main) {
    const [source, destination, ...extra] = process.argv.slice(2)
    if (!source || !destination || extra.length > 0)
        throw new Error('Expected migration source and fresh output directory.')
    await packageMigrations(source, destination)
}

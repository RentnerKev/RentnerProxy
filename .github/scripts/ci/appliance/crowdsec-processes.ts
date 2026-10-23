// oxlint-disable no-await-in-loop -- Read each enumerated process once without spawning a subprocess per PID.

export async function readCrowdSecEngineUids(
    procRoot = '/proc',
    readStatus?: (path: string) => Promise<string>,
): Promise<string[]> {
    const { readdir, readFile } = await import('node:fs/promises')
    const uids: string[] = []
    for (const pid of await readdir(procRoot)) {
        if (!/^\d+$/u.test(pid)) continue
        let status: string
        try {
            const path = procRoot + '/' + pid + '/status'
            status = await (readStatus ? readStatus(path) : readFile(path, 'utf8'))
        } catch (error) {
            // A process can disappear before open (ENOENT) or before read (ESRCH).
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error.code === 'ENOENT' || error.code === 'ESRCH')
            )
                continue
            throw error
        }
        if (!/^Name:[\t ]+crowdsec\r?$/mu.test(status)) continue
        const uid = /^Uid:[\t ]+(\d+)[\t ]/mu.exec(status)?.[1]
        if (uid === undefined) throw new Error('CrowdSec process status is missing its UID')
        uids.push(uid)
    }
    return uids
}

export function crowdSecEngineUidProbe(procRoot = '/proc'): string {
    // The same self-contained function runs inside the appliance and in regression tests.
    return `const uids = await (${readCrowdSecEngineUids.toString()})(${JSON.stringify(procRoot)}); process.stdout.write(JSON.stringify(uids));`
}

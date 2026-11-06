import type { GitHubIssue } from './Types/release-notes.types.ts'

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu

export function contributorLogins(issues: readonly GitHubIssue[]): string[] {
    const contributors = new Map<string, string>()
    for (const { user } of issues) {
        if (!user || user.type?.toLowerCase() === 'bot' || !LOGIN.test(user.login.trim())) continue
        const login = user.login.trim()
        contributors.set(login.toLowerCase(), login)
    }
    return [...contributors.values()].toSorted((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' }),
    )
}

export function contributorAvatarAssetName(login: string): string {
    if (!LOGIN.test(login)) throw new Error('Invalid contributor login')
    return `contributor-${login.toLowerCase()}.png`
}

export function renderContributorAvatar(bytes: Uint8Array): string {
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    if ((!png && !jpeg) || bytes.length > 262_144) throw new Error('Invalid contributor image')
    const type = png ? 'png' : 'jpeg'
    const data = Buffer.from(bytes).toString('base64')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><clipPath id="avatar"><circle cx="48" cy="48" r="48"/></clipPath></defs><image width="96" height="96" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)" href="data:image/${type};base64,${data}"/></svg>\n`
}

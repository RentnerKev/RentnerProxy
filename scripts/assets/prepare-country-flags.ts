import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countries } from 'country-flag-icons'
import { version } from 'country-flag-icons/package.json'

export async function prepareCountryFlags(publicDirectory: string): Promise<void> {
    const packageRoot = dirname(
        fileURLToPath(import.meta.resolve('country-flag-icons/package.json')),
    )
    const destination = join(publicDirectory, 'assets', 'country-flags', version)
    await mkdir(destination, { recursive: true })
    await Promise.all(
        countries
            .filter((code) => /^[A-Z]{2}$/u.test(code))
            .map((code) =>
                copyFile(join(packageRoot, '3x2', `${code}.svg`), join(destination, `${code}.svg`)),
            ),
    )
}

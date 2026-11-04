import { expect, test } from 'bun:test'
import { imagePlatform, imagePlatforms } from '@/lib/ApplicationVersion/imagePlatform.ts'

test('canonicalizes supported ARM64/v8 images without equating other requirements', () => {
    expect(imagePlatform('linux/amd64')).toBe('linux/amd64')
    expect(imagePlatform('linux/arm64')).toBe('linux/arm64')
    expect(imagePlatform('linux/arm64/v8')).toBe('linux/arm64')
    for (const invalid of [
        'linux/arm64/v9',
        'linux/amd64/v8',
        'linux/arm',
        'windows/arm64',
        'linux/arm64\n',
    ])
        expect(imagePlatform(invalid)).toBeNull()
    expect(imagePlatforms(['linux/amd64', 'linux/arm64/v8'])).toEqual([
        'linux/amd64',
        'linux/arm64',
    ])
    for (const invalid of [
        [],
        ['linux/arm64', 'linux/arm64/v8'],
        ['linux/amd64', 'linux/amd64'],
        ['linux/amd64', 'windows/arm64'],
    ])
        expect(imagePlatforms(invalid)).toBeNull()
})

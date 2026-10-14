import type {
    PreviewArtifactMetadata,
    ArtifactExpectation,
    WorkflowRun,
    TriggerProof,
} from '../Types/pr-preview.types.ts'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import {
    asRecord,
    stringValue,
    parsePositiveInteger,
    validateFullSha,
    parseTestedShaProof,
    parsePullRequestNumberProof,
    validateSha256Hex,
    normalizeRepository,
} from './validation.ts'

export const PREVIEW_ARTIFACT_NAME = 'pr-preview-image'

const PREVIEW_PLATFORM = 'linux/amd64'

export const MAX_PREVIEW_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024

export async function readTriggerProof(artifactDirectory: string): Promise<TriggerProof> {
    const entries = await readdir(artifactDirectory, { withFileTypes: true })
    const proofNames = new Set(['pr-number.txt', 'tested-sha.txt'])
    if (entries.length !== proofNames.size) {
        throw new Error('Pull request trigger proof artifact is invalid.')
    }
    for (const entry of entries) {
        if (!proofNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
            throw new Error('Pull request trigger proof artifact is invalid.')
        }
    }
    const pullRequestNumberPath = `${artifactDirectory}/pr-number.txt`
    const testedShaPath = `${artifactDirectory}/tested-sha.txt`
    const [pullRequestNumberStat, testedShaStat] = await Promise.all([
        lstat(pullRequestNumberPath),
        lstat(testedShaPath),
    ])
    if (
        !pullRequestNumberStat.isFile() ||
        pullRequestNumberStat.size < 2 ||
        pullRequestNumberStat.size > 17
    ) {
        throw new Error('Pull request number proof file is invalid.')
    }
    if (!testedShaStat.isFile() || testedShaStat.size !== 41) {
        throw new Error('Tested SHA proof file is invalid.')
    }
    const [pullRequestNumber, testedSha] = await Promise.all([
        readFile(pullRequestNumberPath, 'utf8').then(parsePullRequestNumberProof),
        readFile(testedShaPath, 'utf8').then(parseTestedShaProof),
    ])
    return { pullRequestNumber, testedSha }
}

export function validateBuildArtifactMetadata(
    metadata: PreviewArtifactMetadata,
    repository: string,
    workflowRun: WorkflowRun,
): void {
    if (
        metadata.artifactName !== PREVIEW_ARTIFACT_NAME ||
        metadata.platform !== PREVIEW_PLATFORM ||
        metadata.repository !== repository ||
        metadata.runId !== workflowRun.id ||
        metadata.runAttempt !== workflowRun.runAttempt
    ) {
        throw new Error('Preview artifact does not match its source workflow run.')
    }
}

const metadataKeys = [
    'artifactName',
    'baseSha',
    'createdAt',
    'headRepository',
    'headSha',
    'ociSha256',
    'platform',
    'pullRequestNumber',
    'repository',
    'runAttempt',
    'runId',
    'schemaVersion',
    'testedSha',
    'triggerRunId',
] as const

export function parsePreviewArtifactMetadata(value: unknown): PreviewArtifactMetadata {
    const metadata = asRecord(value, 'Preview artifact metadata')
    const actualKeys = Object.keys(metadata).toSorted()
    if (actualKeys.join('\0') !== metadataKeys.toSorted().join('\0')) {
        throw new Error('Preview artifact metadata fields are invalid.')
    }
    if (metadata.schemaVersion !== 1) {
        throw new Error('Preview artifact metadata schema is unsupported.')
    }
    const createdAt = stringValue(metadata.createdAt, 'Artifact creation time')
    const timestamp = Date.parse(createdAt)
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== createdAt) {
        throw new Error('Artifact creation time is invalid.')
    }

    return {
        artifactName: stringValue(metadata.artifactName, 'Artifact name'),
        baseSha: validateFullSha(metadata.baseSha, 'Artifact base SHA'),
        createdAt,
        headRepository: normalizeRepository(metadata.headRepository),
        headSha: validateFullSha(metadata.headSha, 'Artifact head SHA'),
        ociSha256: validateSha256Hex(metadata.ociSha256, 'OCI archive SHA-256'),
        platform: stringValue(metadata.platform, 'Artifact platform'),
        pullRequestNumber: parsePositiveInteger(
            metadata.pullRequestNumber,
            'Artifact pull request number',
        ),
        repository: normalizeRepository(metadata.repository),
        runAttempt: parsePositiveInteger(metadata.runAttempt, 'Artifact run attempt'),
        runId: parsePositiveInteger(metadata.runId, 'Artifact run ID'),
        schemaVersion: 1,
        testedSha: validateFullSha(metadata.testedSha, 'Artifact tested SHA'),
        triggerRunId: parsePositiveInteger(metadata.triggerRunId, 'Artifact trigger run ID'),
    }
}

async function sha256File(path: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
}

export async function readArtifactDirectory(
    artifactDirectory: string,
): Promise<PreviewArtifactMetadata> {
    const entries = await readdir(artifactDirectory, { withFileTypes: true })
    const names = entries.map((entry) => entry.name).toSorted()
    if (names.join('\0') !== 'metadata.json\0preview-image.tar') {
        throw new Error('OCI artifact contains unexpected files.')
    }
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
        throw new Error('OCI artifact entries must be regular files.')
    }

    const metadataPath = `${artifactDirectory}/metadata.json`
    const archivePath = `${artifactDirectory}/preview-image.tar`
    const [metadataStat, archiveStat] = await Promise.all([lstat(metadataPath), lstat(archivePath)])
    if (!metadataStat.isFile() || metadataStat.size <= 0 || metadataStat.size > 64 * 1024) {
        throw new Error('Preview metadata size is invalid.')
    }
    if (
        !archiveStat.isFile() ||
        archiveStat.size <= 0 ||
        archiveStat.size > MAX_PREVIEW_ARTIFACT_BYTES
    ) {
        throw new Error('OCI archive size is invalid.')
    }

    const metadata = parsePreviewArtifactMetadata(
        JSON.parse(await readFile(metadataPath, 'utf8')) as unknown,
    )
    if ((await sha256File(archivePath)) !== metadata.ociSha256) {
        throw new Error('OCI archive checksum does not match metadata.')
    }
    return metadata
}

export async function validateArtifactDirectory(expectation: ArtifactExpectation): Promise<void> {
    const metadata = await readArtifactDirectory(expectation.artifactDirectory)
    const expectedValues: Readonly<Record<keyof PreviewArtifactMetadata, unknown>> = {
        artifactName: PREVIEW_ARTIFACT_NAME,
        baseSha: expectation.baseSha,
        createdAt: metadata.createdAt,
        headRepository: expectation.headRepository,
        headSha: expectation.headSha,
        ociSha256: metadata.ociSha256,
        platform: PREVIEW_PLATFORM,
        pullRequestNumber: expectation.number,
        repository: expectation.baseRepository,
        runAttempt: expectation.runAttempt,
        runId: expectation.runId,
        schemaVersion: 1,
        testedSha: expectation.testedSha,
        triggerRunId: expectation.triggerRunId,
    }
    for (const key of metadataKeys) {
        if (metadata[key] !== expectedValues[key]) {
            throw new Error(`Preview artifact metadata mismatch: ${key}.`)
        }
    }
}

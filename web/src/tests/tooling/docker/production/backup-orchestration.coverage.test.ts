import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const available =
    process.platform === 'linux' &&
    process.getuid?.() === 0 &&
    Bun.which('initdb') !== null &&
    Bun.which('gosu') !== null
test.skipIf(!available).each(['agent-roundtrip', 'precommit-failure', 'postcommit-failure'])(
    'real isolated PostgreSQL backup %s preserves artifact identity and recovery invariants',
    async (scenario) => {
        const output = await runBunScript(
            `
            import {runBackupOrchestrationFixture} from './web/src/tests/Helpers/backupOrchestrationFixture.ts'
            const result = await runBackupOrchestrationFixture(${JSON.stringify(scenario)})
            console.log('ORCHESTRATION_RESULT=' + JSON.stringify(result))
        `,
            {
                cwd: repositoryRoot,
                env: {
                    ...process.env,
                    PUBLIC_ORIGIN: 'https://fixture.example.test',
                    PROXY_TRUSTED_PROXY_CIDRS: '',
                    RENTNERPROXY_DATABASE_HOST: '127.0.0.1',
                },
            },
        )
        const result = JSON.parse(
            output
                .split('\n')
                .find((line) => line.startsWith('ORCHESTRATION_RESULT='))!
                .slice('ORCHESTRATION_RESULT='.length),
        )
        expect(result).toMatchObject({
            exportState: 'succeeded',
            hashesUnchanged: true,
            inventoryUnchanged: true,
        })
        if (scenario === 'agent-roundtrip') {
            expect(result).toMatchObject({
                restoreState: 'succeeded',
                restoreError: null,
                phase: 'restarting',
                databaseValue: '1',
                sessions: '00000000-0000-4000-8000-000000000003',
                controller: 'old controller state',
                journalExists: false,
                snapshotExists: false,
                keyMatchesBackup: true,
                pendingKeyJournal: false,
                runtimeConfigExcluded: true,
                ddnsPaused: true,
                discoveryPaused: true,
                crowdsecKey: 'a'.repeat(64),
            })
            expect(result).toMatchObject({
                supervisorIdentityVerified: true,
                downloadVerified: true,
                selectedDeleteSafe: true,
            })
        } else if (scenario === 'precommit-failure') {
            expect(result).toMatchObject({
                restoreState: 'failed',
                phase: 'quiescing',
                databaseValue: '2',
                controller: 'new controller state',
                journalExists: false,
                snapshotExists: false,
                keyMatchesBackup: false,
                pendingKeyJournal: false,
                crowdsecKey: 'b'.repeat(64),
            })
        } else {
            expect(result).toMatchObject({
                restoreState: 'failed',
                phase: 'controller',
                databaseValue: '1',
                controller: null,
                journalExists: true,
                snapshotExists: true,
                keyMatchesBackup: true,
                pendingKeyJournal: true,
                crowdsecKey: 'b'.repeat(64),
            })
        }
    },
    45_000,
)

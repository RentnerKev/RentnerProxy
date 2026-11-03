import { afterAll } from 'bun:test'
import { installCoverageCollector, writeCoverageSnapshot } from './collector.ts'

if (installCoverageCollector()) afterAll(writeCoverageSnapshot)

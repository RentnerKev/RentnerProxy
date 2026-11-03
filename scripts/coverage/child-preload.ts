import { installCoverageCollector, writeCoverageSnapshot } from './collector.ts'

if (installCoverageCollector()) process.once('exit', writeCoverageSnapshot)

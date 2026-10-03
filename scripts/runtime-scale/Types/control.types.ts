import type { z } from 'zod'

import type { scaleResultSchema } from '../control.validation.ts'

export type ScaleOptions = {
    hosts: number
    concurrency: number
    rounds: number
    seed: number
    timeoutSeconds: number
    image?: string
    reportPath?: string
}

export type ScaleResult = z.output<typeof scaleResultSchema>

import type { countsSchema } from '../control.validation.ts'
import type { stages } from '../control.config.ts'
import type { ResourceSample } from '../../runtime-reliability/Types/control.types.ts'

export type ScaleCounts = z.output<typeof countsSchema>

export type ScaleStage = (typeof stages)[number]

export type ScaleMeasurement = {
    stage: ScaleStage
    elapsedMilliseconds: number
    counts: ScaleCounts
    desiredRevision: string
    inventoryFingerprint: string
}

export type ScaleResourceSample = { stage: ScaleStage; sample: ResourceSample }

export type ScaleFailure = {
    stage: ScaleStage
    category: 'assertion' | 'timeout' | 'command' | 'telemetry' | 'unexpected'
}

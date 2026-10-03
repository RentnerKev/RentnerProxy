export type ContextStage =
    | 'registry'
    | 'actor-read'
    | 'actor-create'
    | 'session-delete'
    | 'session-create'
    | 'state-write'
    | 'state-chmod'

import type { z } from 'zod'
import type { commandSchema, stateSchema } from '../fixture.validation.ts'
import type { createFixtureContext } from '../fixture-context.ts'

export type FixtureCommand = z.output<typeof commandSchema>

export type FixtureState = z.output<typeof stateSchema>

export type FixtureContext = Awaited<ReturnType<typeof createFixtureContext>>

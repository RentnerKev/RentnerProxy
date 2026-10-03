import type { smokeSuites } from '../production-smoke-ci.ts'

export type Suite = keyof typeof smokeSuites

export type Result = { status: 'PASS' | 'FAIL'; checks: number; seconds: number }

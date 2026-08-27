export const CONTROLLER_SERVICE = 'rentnerproxy-controller' as const

export type ControllerHealthPayload = Readonly<{
  status: 'ok'
  service: typeof CONTROLLER_SERVICE
  version?: string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Validate the controller response at the server-side HTTP trust boundary. */
export function parseControllerHealth(value: unknown): ControllerHealthPayload | null {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    value.service !== CONTROLLER_SERVICE ||
    ('version' in value && (typeof value.version !== 'string' || value.version.length === 0))
  ) {
    return null
  }

  return typeof value.version === 'string'
    ? { status: 'ok', service: CONTROLLER_SERVICE, version: value.version }
    : { status: 'ok', service: CONTROLLER_SERVICE }
}

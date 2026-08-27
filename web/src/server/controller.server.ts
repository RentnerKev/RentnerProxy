import { parseControllerHealth } from './controller-health'
import { getControllerBaseUrl } from './env.server'

export type PreparedControllerHealth =
  | Readonly<{ state: 'connected' }>
  | Readonly<{ state: 'unavailable' }>

const HEALTH_TIMEOUT_MS = 1_200

function unavailable(reason: string): PreparedControllerHealth {
  // Keep logs useful while never logging endpoint values, response bodies, or errors.
  console.warn(`[controller] health check unavailable: ${reason}`)
  return { state: 'unavailable' }
}

export async function checkControllerHealth(): Promise<PreparedControllerHealth> {
  const baseUrl = getControllerBaseUrl()

  if (!baseUrl) {
    return unavailable('invalid_base_url')
  }

  const requestAbort = new AbortController()
  const timeout = setTimeout(() => requestAbort.abort(), HEALTH_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { accept: 'application/json' },
      signal: requestAbort.signal,
    })

    if (!response.ok) {
      return unavailable(`http_${response.status}`)
    }

    let payload: unknown

    try {
      payload = await response.json()
    } catch {
      return unavailable('invalid_json')
    }

    return parseControllerHealth(payload) ? { state: 'connected' } : unavailable('invalid_payload')
  } catch {
    return unavailable('request_failed')
  } finally {
    clearTimeout(timeout)
  }
}

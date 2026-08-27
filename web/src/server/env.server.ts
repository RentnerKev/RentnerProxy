import '@tanstack/react-start/server-only'

const DEFAULT_CONTROLLER_BASE_URL = 'http://127.0.0.1:8081'

function normalizeControllerBaseUrl(value: string): string | null {
  try {
    const url = new URL(value)

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.hostname
    ) {
      return null
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** Returns null for an explicitly configured but invalid endpoint. */
export function getControllerBaseUrl(): string | null {
  const configured = process.env.RENTNERPROXY_CONTROLLER_URL

  if (configured === undefined) {
    return DEFAULT_CONTROLLER_BASE_URL
  }

  return normalizeControllerBaseUrl(configured.trim())
}

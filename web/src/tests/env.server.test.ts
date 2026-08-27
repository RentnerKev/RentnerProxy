import { afterEach, describe, expect, test } from 'bun:test'

import { getControllerBaseUrl } from '../server/env.server'

const VARIABLE = 'RENTNERPROXY_CONTROLLER_URL'
const originalValue = process.env[VARIABLE]

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[VARIABLE]
    return
  }

  process.env[VARIABLE] = originalValue
})

describe('getControllerBaseUrl', () => {
  test('uses the loopback default only when the variable is absent', () => {
    delete process.env[VARIABLE]

    expect(getControllerBaseUrl()).toBe('http://127.0.0.1:8081')
  })

  test('rejects an explicitly blank value', () => {
    process.env[VARIABLE] = '   '

    expect(getControllerBaseUrl()).toBeNull()
  })

  test('normalizes a valid configured URL', () => {
    process.env[VARIABLE] = ' https://controller.example:8443/ '

    expect(getControllerBaseUrl()).toBe('https://controller.example:8443')
  })
})

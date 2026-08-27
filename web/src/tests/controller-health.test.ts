import { describe, expect, test } from 'bun:test'
import { CONTROLLER_SERVICE, parseControllerHealth } from '../server/controller-health'

describe('parseControllerHealth', () => {
  test('accepts the controller payload and preserves its version', () => {
    expect(
      parseControllerHealth({
        status: 'ok',
        service: CONTROLLER_SERVICE,
        version: '0.0.0',
        extra: 'ignored',
      }),
    ).toEqual({
      status: 'ok',
      service: CONTROLLER_SERVICE,
      version: '0.0.0',
    })
  })

  test('accepts a valid payload without an optional version', () => {
    expect(parseControllerHealth({ status: 'ok', service: CONTROLLER_SERVICE })).toEqual({
      status: 'ok',
      service: CONTROLLER_SERVICE,
    })
  })

  test('rejects malformed payloads and responses from another service', () => {
    expect(parseControllerHealth(null)).toBeNull()
    expect(parseControllerHealth({ status: 'healthy', service: CONTROLLER_SERVICE })).toBeNull()
    expect(parseControllerHealth({ status: 'ok' })).toBeNull()
    expect(parseControllerHealth({ status: 'ok', service: 'another-service' })).toBeNull()
    expect(
      parseControllerHealth({ status: 'ok', service: CONTROLLER_SERVICE, version: 1 }),
    ).toBeNull()
  })
})

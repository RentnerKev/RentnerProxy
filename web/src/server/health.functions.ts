import { createServerFn } from '@tanstack/react-start'
import { checkControllerHealth } from './controller.server'

export const getControllerHealth = createServerFn({ method: 'GET' }).handler(() =>
  checkControllerHealth(),
)

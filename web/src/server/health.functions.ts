import { createServerFn } from '@tanstack/react-start'
import { checkFoundationHealth } from './health.server'

export const getFoundationHealth = createServerFn({ method: 'GET' }).handler(() =>
    checkFoundationHealth(),
)

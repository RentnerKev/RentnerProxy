export type BoundaryValidator = ((input: unknown) => unknown) | { parse(input: unknown): unknown }
export type BoundaryHandler = (input: { data: unknown }) => unknown
export type BoundaryCall = { name: string; arguments: unknown[] }

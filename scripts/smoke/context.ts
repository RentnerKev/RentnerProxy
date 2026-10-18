// Preserve accessors so captured helpers and cleanup observe recreated resource handles.
export function extendSmokeContext<T extends object, U extends object>(
    context: T,
    values: U,
): T & U {
    return Object.defineProperties(context, Object.getOwnPropertyDescriptors(values)) as T & U
}

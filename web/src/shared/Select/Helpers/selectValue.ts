export const EMPTY_SELECT_VALUE = '__rentnerproxy_empty_select_value__'

export function toSelectValue(value: string): string {
    return value || EMPTY_SELECT_VALUE
}

export function fromSelectValue(value: string): string {
    return value === EMPTY_SELECT_VALUE ? '' : value
}

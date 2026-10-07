export interface TxtRecord {
    readonly id: string
    readonly type: 'TXT'
    readonly name: string
    readonly content: string
    readonly comment?: string
}

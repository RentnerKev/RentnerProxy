import type { DnsFixtureDelegation, TxtRecord } from './Types/dns-fixture.types.ts'

function name(value: string): Buffer {
    return Buffer.concat([
        ...value
            .split('.')
            .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
        Buffer.from([0]),
    ])
}

function record(owner: string, type: number, data: Buffer): Buffer {
    const header = Buffer.alloc(10)
    header.writeUInt16BE(type, 0)
    header.writeUInt16BE(1, 2)
    header.writeUInt32BE(1, 4)
    header.writeUInt16BE(data.length, 8)
    return Buffer.concat([name(owner), header, data])
}

export function delegationAnswers(
    owner: string,
    type: number,
    records: readonly TxtRecord[],
    delegation: DnsFixtureDelegation,
): { answers: Buffer[]; authorities: Buffer[] } {
    const answers: Buffer[] = []
    const authorities: Buffer[] = []
    let terminal = owner
    const visited = new Set<string>()
    while (delegation.cnames.has(terminal) && !visited.has(terminal) && visited.size < 10) {
        visited.add(terminal)
        const target = delegation.cnames.get(terminal)!
        answers.push(record(terminal, 5, name(target)))
        terminal = target
        if (type === 5) break
    }
    if (type === 16 && !delegation.cnames.has(terminal)) {
        for (const entry of records.filter((candidate) => candidate.name === terminal)) {
            const text = Buffer.from(entry.content)
            if (text.length <= 255)
                answers.push(
                    record(terminal, 16, Buffer.concat([Buffer.from([text.length]), text])),
                )
        }
    }
    if (type === 2) {
        for (const target of delegation.nameservers.get(terminal) ?? [])
            answers.push(record(terminal, 2, name(target)))
    }
    const zone = [...delegation.zones.values()]
        .filter((candidate) => terminal === candidate || terminal.endsWith('.' + candidate))
        .toSorted((left, right) => right.length - left.length)[0]
    if (zone && (type === 6 || answers.length === 0)) {
        const timers = Buffer.alloc(20)
        for (let offset = 0; offset < timers.length; offset += 4) timers.writeUInt32BE(1, offset)
        const soa = record(
            zone,
            6,
            Buffer.concat([name('ns.fixture.invalid'), name('hostmaster.fixture.invalid'), timers]),
        )
        if (type === 6 && terminal === zone) answers.push(soa)
        else authorities.push(soa)
    }
    return { answers, authorities }
}

export type ScenarioDescriptionKey =
    | 'bruteForce'
    | 'scanning'
    | 'crawling'
    | 'flooding'
    | 'exploit'
    | 'generic'

export function scenarioDescriptionKey(scenario: string): ScenarioDescriptionKey {
    const normalized = scenario.toLowerCase()
    if (/(?:^|[-_/])(?:bf|bruteforce|brute-force)(?:$|[-_/])/u.test(normalized)) return 'bruteForce'
    if (/(?:scan|probing|probe|enumeration)/u.test(normalized)) return 'scanning'
    if (/(?:crawl|scrap)/u.test(normalized)) return 'crawling'
    if (/(?:dos|flood|ddos)/u.test(normalized)) return 'flooding'
    if (/(?:exploit|cve-)/u.test(normalized)) return 'exploit'
    return 'generic'
}

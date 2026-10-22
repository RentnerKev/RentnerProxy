export function commandOption(
    args: readonly string[],
    name: string,
    operation: string,
): string | undefined {
    const index = args.indexOf(name)
    if (index === -1) return undefined
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error('invalid ' + operation + ' options')
    return value
}

export function readComposeProject(
    args: readonly string[],
    environmentProject: string | undefined,
    operation: string,
): string | undefined {
    const value = commandOption(args, '--project', operation) ?? environmentProject?.trim()
    if (value === undefined || value === '') return undefined
    if (!/^[a-z0-9][a-z0-9_-]*$/u.test(value)) throw new Error('invalid Compose project name')
    return value
}

export function composeArguments(project: string | undefined, composeFile: string): string[] {
    return [
        'docker',
        'compose',
        ...(project ? ['--project-name', project] : []),
        '--file',
        composeFile,
    ]
}

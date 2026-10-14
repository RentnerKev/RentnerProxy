export async function isWebReady(): Promise<boolean> {
    try {
        const response = await fetch('http://127.0.0.1:3000/health/ready')
        await response.body?.cancel()
        return response.ok
    } catch {
        return false
    }
}

if (import.meta.main) {
    process.exitCode = (await isWebReady()) ? 0 : 1
}

try {
    const response = await fetch('http://127.0.0.1:3000/health/ready')
    await response.body?.cancel()
    process.exitCode = response.ok ? 0 : 1
} catch {
    process.exitCode = 1
}

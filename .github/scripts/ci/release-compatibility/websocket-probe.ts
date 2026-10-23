export function webSocketProbeScript(input: {
    readonly url: string
    readonly expectedMessage: string
    readonly headers?: Readonly<Record<string, string>>
    readonly timeoutMs?: number
}): string {
    const timeoutMs = input.timeoutMs ?? 10_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
        throw new Error('invalid WebSocket probe timeout')
    return [
        'let received=false;let finished=false;',
        `const socket=new WebSocket(${JSON.stringify(input.url)},${JSON.stringify({ headers: input.headers ?? {} })});`,
        'function finish(success){if(finished)return;finished=true;clearTimeout(timer);if(success)process.stdout.write("websocket-ok");process.exit(success?0:1);}',
        `const timer=setTimeout(()=>finish(false),${timeoutMs});`,
        `socket.onmessage=(event)=>{if(event.data!==${JSON.stringify(input.expectedMessage)}){finish(false);return;}received=true;socket.close(1000);};`,
        'socket.onclose=(event)=>finish(received&&event.code===1000);',
        'socket.onerror=()=>finish(false);',
    ].join('')
}

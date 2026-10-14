// Runtime bundles retain the contracts of their TypeScript source modules.
declare module '*web/dist/server/server.js' {
    const application: typeof import('../../../web/src/server.ts').default
    export default application
}

declare module '*web/dist/server/realtimeWebSocket.js' {
    export const createLiveWebSocketRuntime: typeof import('../../../web/src/server/WebSockets/realtimeWebSocket.ts').createLiveWebSocketRuntime
}

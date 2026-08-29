const rootClassName =
    'grid min-h-screen min-w-0 bg-canvas text-ink transition-[grid-template-columns,background-color,color] duration-[180ms] motion-reduce:transition-none'
const sidebarClassName =
    'relative z-30 isolate min-w-0 flex-col overflow-hidden text-white opacity-100 transition-opacity duration-[180ms] motion-reduce:transition-none shell:sticky shell:top-0 shell:h-screen shell:box-border'

export default function getApplicationShellLayoutClassNames(isNavigationExpanded: boolean) {
    return {
        root: `${rootClassName} ${
            isNavigationExpanded
                ? 'shell:grid-cols-[19rem_minmax(0,1fr)]'
                : 'shell:grid-cols-[0_minmax(0,1fr)]'
        }`,
        sidebar: `${sidebarClassName} ${
            isNavigationExpanded
                ? 'flex'
                : 'hidden shell:pointer-events-none shell:flex shell:opacity-0'
        }`,
    }
}

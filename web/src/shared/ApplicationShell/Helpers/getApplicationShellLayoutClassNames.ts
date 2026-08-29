const rootClassName =
    'grid min-h-screen min-w-0 bg-canvas text-ink transition-[grid-template-columns,background-color,color] duration-[180ms] motion-reduce:transition-none'
const sidebarClassName =
    'relative min-w-0 flex-col gap-5 overflow-hidden bg-navy-950 bg-[radial-gradient(circle_at_10%_0%,rgba(48,238,97,0.13),transparent_14rem)] p-4 text-white opacity-100 transition-opacity duration-[180ms] motion-reduce:transition-none shell:sticky shell:top-0 shell:h-screen shell:box-border shell:gap-6 shell:px-[1.35rem] shell:py-7'

export default function getApplicationShellLayoutClassNames(isNavigationExpanded: boolean) {
    return {
        root: `${rootClassName} ${
            isNavigationExpanded
                ? 'shell:grid-cols-[17rem_minmax(0,1fr)]'
                : 'shell:grid-cols-[0_minmax(0,1fr)]'
        }`,
        sidebar: `${sidebarClassName} ${
            isNavigationExpanded
                ? 'flex'
                : 'hidden shell:pointer-events-none shell:flex shell:opacity-0'
        }`,
    }
}

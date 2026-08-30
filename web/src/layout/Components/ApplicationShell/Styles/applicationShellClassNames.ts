import { uiClassNames } from '../../../../shared/Styles/uiClassNames'

const sidebarBackgroundClassName =
    "bg-navy-950 bg-[linear-gradient(180deg,rgb(2_10_11_/_78%),rgb(2_10_11_/_93%)),url('/login-panel-background-v1.png')] bg-cover bg-[position:72%_center]"
const desktopSurfaceMaskClassName =
    "[-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] [-webkit-mask-position:left,right] [-webkit-mask-repeat:no-repeat,no-repeat] [-webkit-mask-size:calc(100%_-_5rem)_100%,5rem_100%] [mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] [mask-position:left,right] [mask-repeat:no-repeat,no-repeat] [mask-size:calc(100%_-_5rem)_100%,5rem_100%]"
const mobileSurfaceMaskClassName =
    "[-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-mobile.svg')] [-webkit-mask-position:top,bottom] [-webkit-mask-repeat:no-repeat,no-repeat] [-webkit-mask-size:100%_calc(100%_-_5rem),100%_5rem] [mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-mobile.svg')] [mask-position:top,bottom] [mask-repeat:no-repeat,no-repeat] [mask-size:100%_calc(100%_-_5rem),100%_5rem]"
const desktopContentMaskClassName =
    "shell:[-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] shell:[-webkit-mask-position:left,right] shell:[-webkit-mask-repeat:no-repeat,no-repeat] shell:[-webkit-mask-size:calc(100%_-_5rem)_100%,5rem_100%] shell:[mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] shell:[mask-position:left,right] shell:[mask-repeat:no-repeat,no-repeat] shell:[mask-size:calc(100%_-_5rem)_100%,5rem_100%]"

const topbarBaseClassName =
    'relative flex min-h-14 items-center justify-between gap-4 overflow-hidden border-b border-border bg-topbar px-5 py-[0.8rem] transition-[margin,padding] duration-[180ms] shell:sticky shell:top-0 shell:z-20 shell:backdrop-blur-[16px] motion-reduce:transition-none'
const navigationLinkClassName =
    'group relative inline-flex w-full flex-none cursor-pointer items-center gap-[0.65rem] border-y border-transparent px-3.5 py-[0.72rem] text-[0.85rem] font-[750] text-mist-300 no-underline transition-[background-color,border-color,color] duration-[180ms] hover:border-white/10 hover:bg-white/[0.055] hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300 shell:-ml-[1.35rem] shell:w-[calc(100%+4.125rem)] shell:pl-[2.2rem] motion-reduce:transition-none [&>span]:size-[0.42rem] [&>span]:shrink-0 [&>span]:rounded-full [&>span]:bg-mist-500 [&>span]:transition-colors [&>span]:duration-[180ms] hover:[&>span]:bg-brand-300'

export function getApplicationTopbarClassName(isNavigationExpanded: boolean): string {
    return `${topbarBaseClassName} ${
        isNavigationExpanded
            ? 'shell:-ml-12 shell:pr-8 shell:pl-[5.25rem]'
            : 'shell:ml-0 shell:px-8'
    }`
}

export const applicationShellClassNames = {
    sidebar: {
        content: `relative z-20 flex min-h-0 flex-1 flex-col gap-5 p-4 pb-24 shell:gap-6 shell:py-7 shell:pr-[2.75rem] shell:pl-[1.35rem] ${mobileSurfaceMaskClassName} ${desktopContentMaskClassName}`,
        logoLink:
            'block w-fit max-w-[13rem] cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 shell:max-w-[14rem]',
        logoImage: 'block h-auto w-full',
        divider: 'mr-5 h-px bg-gradient-to-r from-brand-500 via-brand-500/65 to-transparent',
        surface: {
            desktopInner: `pointer-events-none absolute inset-0 z-10 hidden shell:block ${sidebarBackgroundClassName} ${desktopSurfaceMaskClassName}`,
            desktopOuter: `pointer-events-none absolute inset-y-0 -left-2.5 right-0 z-0 hidden translate-x-2.5 bg-brand-600 shell:block ${desktopSurfaceMaskClassName}`,
            mobileInner: `pointer-events-none absolute inset-0 z-10 ${sidebarBackgroundClassName} ${mobileSurfaceMaskClassName} shell:hidden`,
            mobileOuter: `pointer-events-none absolute -top-2.5 right-0 bottom-0 left-0 z-0 translate-y-2.5 bg-brand-600 shell:hidden ${mobileSurfaceMaskClassName}`,
        },
    },
    navigation: {
        root: 'flex gap-[0.4rem] overflow-x-auto pb-1 shell:grid shell:overflow-visible',
        label: `${uiClassNames.technicalLabel} mb-[0.6rem] ml-3 hidden shell:block`,
        link: navigationLinkClassName,
        activeLink: `${navigationLinkClassName} border-brand-500/20 bg-brand-500/12 text-white [&>span]:bg-brand-500`,
    },
    topbar: {
        toggle: 'group grid size-[2.25rem] cursor-pointer place-items-center rounded-full border border-border-strong bg-surface-raised text-muted transition-[border-color,background-color,color] duration-[180ms] hover:border-brand-500 hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-500 motion-reduce:transition-none',
        theme: 'flex items-center',
    },
    userPanel: {
        root: 'relative flex flex-wrap items-center justify-between gap-[0.9rem] overflow-hidden border-y border-white/10 bg-navy-950/80 p-[0.9rem] shadow-[inset_0_1px_0_rgb(255_255_255_/_2%)] backdrop-blur-sm shell:mt-auto shell:-mr-[2.75rem] shell:-ml-[1.35rem] shell:grid shell:pr-[4rem] shell:pl-[2.25rem]',
        identity: 'flex min-w-0 items-center gap-2.5 pr-2',
        identityText: 'grid min-w-0 gap-[0.2rem]',
        displayName:
            'overflow-hidden text-[0.82rem] font-extrabold text-ellipsis whitespace-nowrap',
        email: 'overflow-hidden text-[0.68rem] text-mist-400 text-ellipsis whitespace-nowrap',
        actions:
            'grid w-full grid-cols-2 gap-[0.45rem] pr-1 [&>:only-child]:col-span-full shell:flex shell:justify-between',
        accountAction:
            'inline-flex min-h-[2.35rem] min-w-0 cursor-pointer items-center justify-center gap-[0.45rem] rounded-full border border-white/10 bg-white/[0.04] px-[0.7rem] py-[0.45rem] text-[0.72rem] font-extrabold text-mist-300 no-underline transition-[background-color,color,border-color] duration-150 hover:border-brand-500/35 hover:bg-brand-500/12 hover:text-[#eaffef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none [&>svg]:size-4 [&>svg]:shrink-0',
        logoutAction:
            'inline-flex min-h-[2.35rem] min-w-0 cursor-pointer items-center justify-center gap-[0.45rem] rounded-full border border-red-400/30 bg-red-700/15 px-[0.7rem] py-[0.45rem] text-[0.72rem] font-extrabold text-red-300 transition-[background-color,color,border-color] duration-150 enabled:hover:border-red-300/50 enabled:hover:bg-red-700/25 enabled:hover:text-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-[0.55] motion-reduce:transition-none [&>svg]:size-4 [&>svg]:shrink-0',
    },
} as const

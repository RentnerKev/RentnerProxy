import { applicationShellClassNames } from '../Styles/applicationShellClassNames'

export default function ApplicationSidebarSurface() {
    const classNames = applicationShellClassNames.sidebar.surface

    return (
        <>
            <span className={classNames.mobileOuter} aria-hidden="true" />
            <span className={classNames.mobileInner} aria-hidden="true" />
            <span className={classNames.desktopOuter} aria-hidden="true" />
            <span className={classNames.desktopInner} aria-hidden="true" />
        </>
    )
}

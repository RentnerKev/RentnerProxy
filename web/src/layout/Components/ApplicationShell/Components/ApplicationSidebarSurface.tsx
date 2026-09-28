export default function ApplicationSidebarSurface() {
    return (
        <>
            <span
                className="pointer-events-none absolute inset-y-0 -left-2.5 right-0 z-0 translate-x-2.5 bg-brand-600 [-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] [-webkit-mask-position:left,right] [-webkit-mask-repeat:no-repeat,no-repeat] [-webkit-mask-size:calc(100%-5rem)_100%,5rem_100%] mask-[linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] mask-position-[left,right] [mask-repeat:no-repeat,no-repeat] mask-size-[calc(100%-5rem)_100%,5rem_100%]"
                aria-hidden="true"
            />
            <span
                className="pointer-events-none absolute inset-0 z-10 bg-navy-950 bg-[linear-gradient(180deg,rgb(2_10_11_/_78%),rgb(2_10_11_/_93%)),url('/login-panel-background-v1.png')] bg-cover bg-[position:72%_center] [-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] [-webkit-mask-position:left,right] [-webkit-mask-repeat:no-repeat,no-repeat] [-webkit-mask-size:calc(100%-5rem)_100%,5rem_100%] mask-[linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] mask-position-[left,right] [mask-repeat:no-repeat,no-repeat] mask-size-[calc(100%-5rem)_100%,5rem_100%]"
                aria-hidden="true"
            />
        </>
    )
}

import useLoadingPageDelay from './Hooks/useLoadingPageDelay.ts'
import LoadingPage from './LoadingPage.tsx'

export default function DelayedLoadingPage() {
    const showLoading = useLoadingPageDelay()
    return showLoading ? <LoadingPage /> : null
}

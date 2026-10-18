export interface ProxyConfigEditorTabsProps {
    readonly activeTab: 'edit' | 'active'
    readonly disabled: boolean
    readonly onTabChange: (tab: 'edit' | 'active') => void
}

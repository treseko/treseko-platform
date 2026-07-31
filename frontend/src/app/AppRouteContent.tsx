import { AppRouteCoreContent } from './AppRouteCoreContent'
import { AppRouteModuleContent } from './AppRouteModuleContent'

export function AppRouteContent({ options }: { options: any }) {
  return (
    <>
      <AppRouteCoreContent options={options} />
      <AppRouteModuleContent options={options} />
    </>
  )
}

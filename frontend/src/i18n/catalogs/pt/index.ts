import spanishCatalog from '../es'
import auth from './auth'
import common from './common'
import navigation from './navigation'
import proyectos from '../es/proyectos'
import casos from './casos'
import ejecutarPruebas from './ejecutarPruebas'
import historial from './historial'
import automatizacion from './automatizacion'
import bugs from './bugs'
import reportes from '../es/reportes'
import motorIa from './motorIa'
import inventario from './inventario'
import configuracion from './configuracion'
import dashboard from './dashboard'
import onboarding from './onboarding'
import notifications from './notifications'
import forcePasswordChange from './forcePasswordChange'

// Portuguese modules can be incrementally translated without dropping newer keys.
// Missing entries intentionally use the Spanish catalog until translated.
const catalog = {
  auth: { ...spanishCatalog.auth, ...auth },
  common: { ...spanishCatalog.common, ...common },
  navigation: { ...spanishCatalog.navigation, ...navigation },
  proyectos: { ...spanishCatalog.proyectos, ...proyectos },
  casos: { ...spanishCatalog.casos, ...casos },
  ejecutarPruebas: { ...spanishCatalog.ejecutarPruebas, ...ejecutarPruebas },
  historial: { ...spanishCatalog.historial, ...historial },
  automatizacion: { ...spanishCatalog.automatizacion, ...automatizacion },
  bugs: { ...spanishCatalog.bugs, ...bugs },
  reportes: { ...spanishCatalog.reportes, ...reportes },
  motorIa: { ...spanishCatalog.motorIa, ...motorIa },
  inventario: { ...spanishCatalog.inventario, ...inventario },
  configuracion: { ...spanishCatalog.configuracion, ...configuracion },
  dashboard: { ...spanishCatalog.dashboard, ...dashboard },
  redmine: spanishCatalog.redmine,
  onboarding: { ...spanishCatalog.onboarding, ...onboarding },
  notifications: { ...spanishCatalog.notifications, ...notifications },
  forcePasswordChange: { ...spanishCatalog.forcePasswordChange, ...forcePasswordChange },
  incidencias: spanishCatalog.incidencias,
} as const

export default catalog

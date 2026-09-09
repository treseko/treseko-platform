type Translate = (key: string) => string

const keyParts: Record<string, string> = {
  Servidor: 'Servidor', Computadora: 'Computadora', Laptop: 'Laptop', 'Dispositivo movil': 'Mobile',
  Tablet: 'Tablet', 'Router/Switch': 'RouterSwitch', Impresora: 'Printer', 'Dispositivo IoT': 'Iot',
  'Nodo de ejecucion': 'ExecutionNode', 'Maquina virtual': 'VirtualMachine', Contenedor: 'Container',
  'Herramienta digital': 'DigitalTool', Servicio: 'Service', API: 'Api', 'Base de datos': 'Database', Otro: 'Other',
  fisico: 'Physical', virtual: 'Virtual', digital: 'Digital', Activo: 'Active', Online: 'Online', Offline: 'Offline',
  Mantenimiento: 'Maintenance', 'En Pausa': 'OnHold', Retirado: 'Retired', Desconocido: 'Unknown',
  Critica: 'Critical', Alta: 'High', Media: 'Medium', Baja: 'Low',
  ip: 'Ip', url: 'Url', hostname: 'Hostname', dns: 'Dns', puerto: 'Port', otro: 'Other'
}

export function inventoryLabel(t: Translate, group: string, value: string) {
  const key = `inventario.${group}${keyParts[value] || value}`
  const translated = t(key)
  return translated === key ? value : translated
}

export function inventoryAria(t: Translate, label: string) {
  return `${t('common.formField')}: ${label}`
}

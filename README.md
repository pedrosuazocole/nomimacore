# NominaCore HN

Sistema de Gestion de Planillas y Control de Horarios para Honduras.
Backend Node.js + Express + SQLite (better-sqlite3). Frontend EJS +
Tailwind CSS (CDN), responsivo para escritorio, tablet y movil.

Desarrollado por **Metric Solutions & POS** — WhatsApp +504 9450-2710.

---

## 1. Estructura del Proyecto

```
nominacore/
├── server.js                    # Punto de entrada (arranca Express + auto-migra la BD)
├── package.json
├── .env.example                 # Copiar como .env y ajustar
├── src/
│   ├── app.js                   # Configuracion de Express (middlewares, rutas, vistas)
│   ├── config/
│   │   ├── db.js                # Conexion singleton a SQLite (better-sqlite3)
│   │   └── constants.js         # Valores por defecto de jornadas/recargos
│   ├── database/
│   │   ├── schema.sql           # Definicion de todas las tablas e indices
│   │   └── init.js              # Script de migracion (npm run migrate)
│   ├── models/                  # Acceso a datos (empleadoModel, turnoModel, planillaModel)
│   ├── services/
│   │   └── calculoService.js    # ⭐ Motor de calculo (horas, extras, septimo dia, IHSS/RAP)
│   ├── controllers/             # Logica de negocio por modulo
│   ├── routes/                  # Definicion de endpoints Express
│   ├── views/                   # Plantillas EJS (layout, empleados, turnos, planillas)
│   └── public/                  # CSS/JS/imagenes estaticas
```

## 2. Instalacion Local

Requisitos: Node.js 18 o superior.

```bash
npm install
cp .env.example .env
# Edita .env: ajusta EMPRESA_NOMBRE, WHATSAPP_CONTACTO, y sobre todo
# revisa los porcentajes de IHSS_PORCENTAJE_EMPLEADO / RAP_PORCENTAJE_EMPLEADO
# contra las tablas oficiales vigentes antes de usar en produccion.

npm run migrate     # crea la base de datos SQLite con todas las tablas
npm start            # o "npm run dev" si tienes nodemon para recarga automatica
```

La app queda disponible en `http://localhost:3000`.

## 3. Despliegue en Railway

1. Sube este proyecto a un repositorio de GitHub.
2. En Railway: **New Project > Deploy from GitHub repo**.
3. Agrega un **volumen persistente** montado en `/data` (Railway > Settings > Volumes).
4. Define las variables de entorno (Railway > Variables), como minimo:
   - `DB_PATH=/data/nominacore.db`
   - `NODE_ENV=production`
   - `EMPRESA_NOMBRE`, `WHATSAPP_CONTACTO`, etc.
5. Railway detecta `npm start` automaticamente (definido en `package.json`).
6. En el primer arranque, `server.js` detecta que la base de datos no
   existe y ejecuta la migracion inicial solo; no necesitas correr
   `npm run migrate` manualmente en Railway.
7. Verifica el estado con el endpoint de diagnostico: `https://tuapp.up.railway.app/api/diag`

## 4. Login y Usuarios

En el primer arranque (cuando la tabla `usuarios` esta vacia), el
sistema crea automaticamente un usuario administrador:

```
Usuario:    admin          (o el valor de ADMIN_USERNAME en .env)
Contraseña: NominaCore2026! (o el valor de ADMIN_PASSWORD en .env)
```

⚠️ **Cambia esta contraseña de inmediato** desde `/usuarios` despues del
primer login (o define `ADMIN_USERNAME`/`ADMIN_PASSWORD` propios en tu
`.env` antes del primer arranque en Railway).

- Todas las rutas (excepto `/login`) requieren sesion activa.
- El modulo `/usuarios` (crear, editar, cambiar rol/contraseña) es
  visible y accesible solo para usuarios con rol **ADMIN**.
- Rol **OPERADOR**: acceso a Planillas, Horarios, Empleados y Configuracion,
  sin poder gestionar otros usuarios.
- Proteccion contra fuerza bruta: 5 intentos fallidos bloquean la cuenta
  por 15 minutos.
- Las sesiones se guardan en memoria del proceso (no requieren tablas ni
  dependencias nativas adicionales); si Railway reinicia el contenedor
  (redeploy), los usuarios conectados deben iniciar sesion de nuevo —
  es la unica contrapartida de este enfoque, y es aceptable para una
  herramienta de uso interno.

## 5. Modulos Principales

- **Empleados** (`/empleados`): CRUD completo — nombre, departamento,
  cuenta contable, salario base, tipo de jornada (diurna/nocturna/mixta).
- **Horarios** (`/turnos`): matriz semanal editable por empleado y dia,
  con calculo automatico de horas trabajadas (soporta turnos que cruzan
  medianoche).
- **Planillas** (`/planillas`): crear periodo (semanal/quincenal/mensual),
  procesar con el motor de calculo, y generar el reporte imprimible.
- **Configuracion** (`/configuracion`): jornadas legales, recargos por
  hora extra, porcentajes y techos de IHSS/RAP, datos de la empresa.

## 6. Motor de Calculo (resumen)

Implementado en `src/services/calculoService.js`, replica formula por
formula la logica de la hoja de calculo de referencia del cliente:

```
salario_diario     = salario_mensual / 30
salario_hora        = salario_diario / 8
horas_ordinarias    = 44 (diurna) | 36 (nocturna) | 42 (mixta)
horas_extra          = max(0, horas_totales - horas_ordinarias)

pago_hora_extra(franja) = horas_franja * salario_hora * recargo_franja
  donde recargo: 2pm-7pm=1.25x, 7pm-9pm=1.50x, 6pm-6am=1.75x, feriado=2.00x

salario_ordinario   = dias_trabajados * salario_diario
septimo_dia_pago    = (1 si procede : 0) * salario_diario
salario_total        = salario_ordinario + septimo_dia_pago
sal_mas_he            = salario_total + pago_total_horas_extra

IHSS = min(sal_mas_he, techo_ihss) * porcentaje_ihss
RAP  = min(sal_mas_he, techo_rap)  * porcentaje_rap

subtotal_neto        = sal_mas_he - IHSS - RAP
total_deducciones    = prestamos + vales + impuesto_vecinal + isr
total_a_pagar         = subtotal_neto - total_deducciones
```

⚠️ **Importante**: los porcentajes y techos de IHSS/RAP se configuran en
`/configuracion` (o en `.env` antes del primer arranque) y NO estan
fijos en el codigo, porque cambian por resolucion oficial periodicamente.
Verifica siempre la tabla vigente del IHSS y del RAP antes de procesar
planilla real.

## 7. Impresion de Reportes

El reporte de planilla (`/planillas/:id/reporte`) incluye:
- Selector de formato: **Carta** (tabla resumen + baucher individual con
  firmas de revision/recibido) o **Ticket** (voucher compacto 80mm).
- Boton **Vista Previa** que muestra el contenido exacto antes de imprimir.
- Boton **Imprimir** que abre el dialogo nativo del navegador/SO, donde
  se elige impresora y numero de copias.
- Boton **Descargar PDF** (usa "Guardar como PDF" del dialogo de impresion).
- Boton **Enviar Email** (abre el cliente de correo con el asunto prellenado).
- La preferencia "vista previa siempre" vs "impresion directa" se guarda
  en `/configuracion`.

## 8. Notas de Mantenimiento

- Los datos de empleados NUNCA se borran fisicamente (baja logica con
  `estado = 'INACTIVO'`) para preservar el historial de planillas.
- `src/database/schema.sql` usa `CREATE TABLE IF NOT EXISTS`, por lo que
  correr `npm run migrate` varias veces es seguro.
- Endpoint de diagnostico: `GET /api/diag` (util para troubleshooting en
  Railway: confirma que la BD este conectada y cuantos registros tiene).

---
**Metric Solutions & POS** · WhatsApp: +504 9450-2710

# MC Tierlist - Backend

Backend de un **tierlist de PvP de Minecraft** (Sword, NethPot, UHC), con regiones,
sistema de cuentas con roles y cabeza de skin automática vía la API de Minecraft.

> ⚠️ La carpeta `public/` que venía en el proyecto original (demonlist) **no se tocó**.
> Esas páginas están hechas para el demonlist viejo y NO funcionan con esta nueva API
> (campos y endpoints distintos). El servidor las sigue sirviendo como archivos estáticos,
> pero hay que rehacerlas (o pedirme que las haga) para que funcionen con el tierlist.

## Instalación

```bash
npm install
npm start
```

Requiere **Node.js 18 o superior** (usa `fetch` global para hablar con la API de Mojang).

Al arrancar por primera vez se crean automáticamente:
- `players.json` (vacío)
- `cuentas.json` con una cuenta `root` / `cambiame123` con rol `admin` — **cámbiale la
  contraseña apenas puedas** con `PATCH /api/cuentas/root/contraseña`.

## Conceptos

- **Regiones**: `NA`, `SA`, `EU`.
- **Gamemodes calificados**: `sword`, `nethpot`, `uhc`.
- **Tiers** (de mejor a peor): `HT1, LT1, HT2, LT2, HT3, LT3, HT4, LT4, HT5, LT5`.
- **Puntos por tier**:

  | Tier | Puntos |
  |------|--------|
  | HT1  | 60 |
  | LT1  | 48 |
  | HT2  | 30 |
  | LT2  | 20 |
  | HT3  | 10 |
  | LT3  | 6  |
  | HT4  | 4  |
  | LT4  | 3  |
  | HT5  | 2  |
  | LT5  | 1  |

- **Tier general** = se calcula con la suma de puntos de sword + nethpot + uhc:

  | Rango de puntos | Tier general |
  |------------------|--------------|
  | 106 - 180 | Tier 1 |
  | 60 - 105  | Tier 2 |
  | 31 - 59   | Tier 3 |
  | 11 - 30   | Tier 4 |
  | 0 - 10    | Tier 5 |

## Cabeza de skin (API de Minecraft)

Al registrar un jugador, el backend consulta la API oficial de Mojang
(`https://api.mojang.com/users/profiles/minecraft/{username}`) para:
1. Confirmar que el nombre existe y obtener su UUID y nombre exacto.
2. Generar la URL de la cabeza de la skin con Crafatar:
   `https://crafatar.com/avatars/{uuid}?size=160&overlay`.

Si Mojang no responde (caída, rate-limit, etc.) se usa un respaldo automático con
**mc-heads.net**, que genera la cabeza directamente a partir del nombre de usuario
(`https://mc-heads.net/avatar/{username}/160`) sin necesitar el UUID. El campo
`skinHeadUrl` de cada jugador siempre queda listo para usarse en una etiqueta `<img>`.

## Cuentas y permisos

- Cualquiera puede crear una cuenta normal (`POST /api/cuentas`), con rol `usuario`.
- Para dar el rol `admin` a una cuenta se usa `POST /api/cuentas/:usuario/grant-admin`
  con la contraseña de la cuenta `root` (`rootPassword`).
- Las acciones de gestión del tierlist (registrar/editar/eliminar jugadores, asignar
  tiers, banear cuentas) requieren credenciales de una cuenta `admin`. Se envían así:
  - por headers: `x-admin-usuario` y `x-admin-password`, o
  - dentro del body: `adminUsuario` y `adminContraseña`.

## Endpoints principales

### Configuración
- `GET /api/config` → regiones, gamemodes, tiers, puntos y rangos del tier general.

### Jugadores
- `GET /api/players` → lista todos los jugadores. Filtros opcionales: `?region=NA`,
  `?gamemode=sword&tier=HT1`.
- `GET /api/players/:id` → un jugador.
- `GET /api/players/:id/historial/:gamemode` → historial de cambios de tier.
- `POST /api/players` *(admin)* → `{ username, region }`. Registra al jugador
  buscando sus datos en Mojang/mc-heads.
- `PATCH /api/players/:id` *(admin)* → `{ region, refrescarSkin }`. Edita región o
  refresca la cabeza de la skin.
- `PATCH /api/players/:id/tier` *(admin)* → `{ gamemode, tier }`. Asigna/quita
  (`tier: null`) el tier de un jugador en sword/nethpot/uhc. Recalcula puntos y tier
  general automáticamente.
- `DELETE /api/players/:id` *(admin)* → elimina al jugador.

### Ranking
- `GET /api/leaderboard` → ranking general por puntos totales. Filtro `?region=`.
- `GET /api/leaderboard/:gamemode` → ranking de un solo gamemode, ordenado por tier.

### Cuentas
- `POST /api/cuentas` → registro de cuenta normal.
- `POST /api/login` → `{ username, password }`.
- `GET /api/cuentas` *(admin)*.
- `GET /api/cuentas/:usuario/perfil`
- `PATCH /api/cuentas/:usuario/foto-perfil`
- `PATCH /api/cuentas/:usuario/descripcion`
- `PATCH /api/cuentas/:usuario/contraseña`
- `PATCH /api/cuentas/:usuario/ban` *(admin)*
- `POST /api/cuentas/:usuario/grant-admin` → requiere `rootPassword`.
- `POST /api/cuentas/:usuario/revoke-admin` → requiere `rootPassword`.

## Ejemplo rápido con curl

```bash
# Login
curl -X POST http://localhost:8040/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"root","password":"cambiame123"}'

# Registrar un jugador
curl -X POST http://localhost:8040/api/players \
  -H "Content-Type: application/json" \
  -d '{"username":"Notch","region":"NA","adminUsuario":"root","adminContraseña":"cambiame123"}'

# Asignar tier en sword
curl -X PATCH http://localhost:8040/api/players/<ID>/tier \
  -H "Content-Type: application/json" \
  -d '{"gamemode":"sword","tier":"HT1","adminUsuario":"root","adminContraseña":"cambiame123"}'

# Ver el ranking general
curl http://localhost:8040/api/leaderboard
```

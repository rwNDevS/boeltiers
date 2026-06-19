// server.js
// Backend de un TIERLIST de PvP de Minecraft (Sword, NethPot, UHC)
// Incluye: regiones (NA/SA/EU), tiers (HT1...LT5), sistema de puntos,
// tier general, integración con API de Mojang + ruta propia para heads,
// y sistema de cuentas con roles admin/usuario.

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
});

const PORT = process.env.PORT || 8040;

const playersFile = './players.json';
const cuentasFile = './cuentas.json';

// =====================================================================
// --- CONFIGURACIÓN DEL TIERLIST ---
// =====================================================================

const REGIONES = ['NA', 'SA', 'EU'];

const GAMEMODES = ['sword', 'nethpot', 'uhc'];

const GAMEMODES_NOMBRE = {
    sword: 'Sword',
    nethpot: 'NethPot',
    uhc: 'UHC'
};

const TIERS_ORDEN = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];

const PUNTOS_POR_TIER = {
    HT1: 60,
    LT1: 48,
    HT2: 30,
    LT2: 20,
    HT3: 10,
    LT3: 6,
    HT4: 4,
    LT4: 3,
    HT5: 2,
    LT5: 1
};

const RANGOS_TIER_GENERAL = [
    { tier: 'Tier 1', min: 106, max: 180 },
    { tier: 'Tier 2', min: 60, max: 105 },
    { tier: 'Tier 3', min: 31, max: 59 },
    { tier: 'Tier 4', min: 11, max: 30 },
    { tier: 'Tier 5', min: 0, max: 10 }
];

// =====================================================================
// --- FUNCIONES AUXILIARES DE ARCHIVOS ---
// =====================================================================

function leerArchivo(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`Advertencia: Archivo no encontrado en ${filePath}. Creando archivo vacío.`);
            fs.writeFileSync(filePath, '[]', 'utf8');
            return [];
        }

        const data = fs.readFileSync(filePath, 'utf8');

        if (!data.trim()) {
            fs.writeFileSync(filePath, '[]', 'utf8');
            return [];
        }

        return JSON.parse(data);
    } catch (err) {
        console.error(`Error leyendo ${filePath}:`, err);
        return [];
    }
}

function escribirArchivo(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Error escribiendo ${filePath}:`, err);
        return false;
    }
}

// =====================================================================
// --- CUENTAS ---
// =====================================================================

function normalizarCuenta(cuenta) {
    return {
        usuario: cuenta.usuario,
        contraseña: cuenta.contraseña,
        rol: cuenta.rol || 'usuario',
        banned: cuenta.banned || false,
        fotoPerfil: cuenta.fotoPerfil || null,
        descripcion: cuenta.descripcion || ''
    };
}

function leerCuentasNormalizadas() {
    const cuentas = leerArchivo(cuentasFile);
    let necesitaActualizacion = false;

    let cuentasNormalizadas = cuentas.map(cuenta => {
        const cuentaNormalizada = normalizarCuenta(cuenta);

        if (
            !Object.prototype.hasOwnProperty.call(cuenta, 'fotoPerfil') ||
            !Object.prototype.hasOwnProperty.call(cuenta, 'descripcion') ||
            !Object.prototype.hasOwnProperty.call(cuenta, 'banned')
        ) {
            necesitaActualizacion = true;
        }

        return cuentaNormalizada;
    });

    if (cuentasNormalizadas.length === 0) {
        cuentasNormalizadas = [
            normalizarCuenta({
                usuario: 'root',
                contraseña: 'cambiame123',
                rol: 'admin'
            })
        ];

        necesitaActualizacion = true;

        console.warn(
            'No existían cuentas. Se creó la cuenta "root" / "cambiame123" con rol admin. Cambia esa contraseña cuanto antes.'
        );
    }

    if (necesitaActualizacion) {
        escribirArchivo(cuentasFile, cuentasNormalizadas);
        console.log('Cuentas normalizadas con valores por defecto.');
    }

    return cuentasNormalizadas;
}

function requireAdmin(req, res, next) {
    const usuario = req.headers['x-admin-usuario'] || (req.body && req.body.adminUsuario);
    const contraseña = req.headers['x-admin-password'] || (req.body && req.body.adminContraseña);

    if (!usuario || !contraseña) {
        return res.status(401).json({
            error: 'Se requieren credenciales de administrador.'
        });
    }

    const cuentas = leerCuentasNormalizadas();
    const cuenta = cuentas.find(c => c.usuario === usuario && c.contraseña === contraseña);

    if (!cuenta) {
        return res.status(403).json({ error: 'Credenciales de administrador inválidas' });
    }

    if (cuenta.banned) {
        return res.status(403).json({ error: 'Tu cuenta ha sido suspendida' });
    }

    if (cuenta.rol !== 'admin') {
        return res.status(403).json({ error: 'Se requiere rol de administrador para esta acción' });
    }

    req.admin = cuenta;
    next();
}

// =====================================================================
// --- MINECRAFT / SKINS ---
// =====================================================================

function formatearUUID(uuidSinGuiones) {
    if (!uuidSinGuiones || uuidSinGuiones.length !== 32) return uuidSinGuiones;

    return [
        uuidSinGuiones.slice(0, 8),
        uuidSinGuiones.slice(8, 12),
        uuidSinGuiones.slice(12, 16),
        uuidSinGuiones.slice(16, 20),
        uuidSinGuiones.slice(20)
    ].join('-');
}

function generarSkinHeadUrl(username, size = 160) {
    const nombre = encodeURIComponent(username || 'Steve');
    const tamaño = Math.min(Math.max(parseInt(size) || 160, 32), 512);

    return `/api/skin-head/${nombre}?size=${tamaño}`;
}

async function obtenerDatosMinecraft(username) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
        const resp = await fetch(
            `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
            { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (resp.status === 200) {
            const data = await resp.json();
            const uuid = formatearUUID(data.id);

            return {
                existe: true,
                username: data.name,
                uuid,
                skinHeadUrl: generarSkinHeadUrl(data.name, 160)
            };
        }

        if (resp.status === 404 || resp.status === 204) {
            return {
                existe: false,
                username,
                uuid: null,
                skinHeadUrl: null
            };
        }

        throw new Error(`Mojang API respondió con estado ${resp.status}`);
    } catch (err) {
        clearTimeout(timeoutId);

        console.warn(
            `No se pudo confirmar "${username}" contra la API de Mojang (${err.message}). Usando skin por nombre.`
        );

        return {
            existe: null,
            username,
            uuid: null,
            skinHeadUrl: generarSkinHeadUrl(username, 160)
        };
    }
}

// =====================================================================
// --- JUGADORES ---
// =====================================================================

function calcularPuntosDeTier(tier) {
    if (!tier) return 0;
    return PUNTOS_POR_TIER[tier] || 0;
}

function calcularTierGeneral(totalPuntos) {
    const rango = RANGOS_TIER_GENERAL.find(r => totalPuntos >= r.min && totalPuntos <= r.max);
    return rango ? rango.tier : 'Tier 5';
}

function recalcularPuntos(jugador) {
    const sword = calcularPuntosDeTier(jugador.tiers.sword);
    const nethpot = calcularPuntosDeTier(jugador.tiers.nethpot);
    const uhc = calcularPuntosDeTier(jugador.tiers.uhc);
    const total = sword + nethpot + uhc;

    jugador.puntos = { sword, nethpot, uhc, total };
    jugador.tierGeneral = calcularTierGeneral(total);

    return jugador;
}

function normalizarJugador(jugador) {
    const username = jugador.username || 'Steve';

    const jugadorNormalizado = {
        id: jugador.id,
        username,
        uuid: jugador.uuid || null,
        region: jugador.region,
        skinHeadUrl: generarSkinHeadUrl(username, 160),
        tiers: {
            sword: jugador.tiers ? jugador.tiers.sword || null : null,
            nethpot: jugador.tiers ? jugador.tiers.nethpot || null : null,
            uhc: jugador.tiers ? jugador.tiers.uhc || null : null
        },
        historialTiers: {
            sword: (jugador.historialTiers && jugador.historialTiers.sword) || [],
            nethpot: (jugador.historialTiers && jugador.historialTiers.nethpot) || [],
            uhc: (jugador.historialTiers && jugador.historialTiers.uhc) || []
        },
        fechaRegistro: jugador.fechaRegistro || new Date().toISOString()
    };

    return recalcularPuntos(jugadorNormalizado);
}

function leerJugadoresNormalizados() {
    const jugadores = leerArchivo(playersFile);
    const normalizados = jugadores.map(normalizarJugador);

    escribirArchivo(playersFile, normalizados);

    return normalizados;
}

function registrarCambioTier(jugador, gamemode, nuevoTier) {
    const historial = jugador.historialTiers[gamemode];
    const ultimo = historial.length > 0 ? historial[historial.length - 1].tier : undefined;

    if (ultimo !== (nuevoTier || null)) {
        historial.push({
            tier: nuevoTier || null,
            fecha: new Date().toISOString()
        });
    }
}

// =====================================================================
// --- RUTA: CABEZA DE SKIN DE MINECRAFT ---
// =====================================================================

app.get('/api/skin-head/:username', (req, res) => {
    const { username } = req.params;
    const size = Math.min(Math.max(parseInt(req.query.size) || 160, 32), 512);

    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
        return res.redirect(`https://mc-heads.net/avatar/Steve/${size}`);
    }

    res.redirect(`https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`);
});

// =====================================================================
// --- RUTAS: CONFIGURACIÓN ---
// =====================================================================

app.get('/api/config', (req, res) => {
    res.json({
        regiones: REGIONES,
        gamemodes: GAMEMODES,
        gamemodesNombre: GAMEMODES_NOMBRE,
        tiersOrden: TIERS_ORDEN,
        puntosPorTier: PUNTOS_POR_TIER,
        rangosTierGeneral: RANGOS_TIER_GENERAL
    });
});

// =====================================================================
// --- RUTAS: JUGADORES ---
// =====================================================================

app.get('/api/players', (req, res) => {
    console.log('GET /api/players - Solicitado.');

    let jugadores = leerJugadoresNormalizados();

    const { region, gamemode, tier } = req.query;

    if (region) {
        jugadores = jugadores.filter(j => j.region === region.toUpperCase());
    }

    if (gamemode && GAMEMODES.includes(gamemode)) {
        if (tier) {
            jugadores = jugadores.filter(j => j.tiers[gamemode] === tier.toUpperCase());
        } else {
            jugadores = jugadores.filter(j => j.tiers[gamemode] !== null);
        }
    }

    res.json(jugadores);
});

app.get('/api/players/:id', (req, res) => {
    const { id } = req.params;
    const jugadores = leerJugadoresNormalizados();
    const jugador = jugadores.find(j => j.id === id);

    if (!jugador) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    res.json(jugador);
});

app.get('/api/players/:id/historial/:gamemode', (req, res) => {
    const { id, gamemode } = req.params;

    if (!GAMEMODES.includes(gamemode)) {
        return res.status(400).json({
            error: `Gamemode inválido. Debe ser uno de: ${GAMEMODES.join(', ')}`
        });
    }

    const jugadores = leerJugadoresNormalizados();
    const jugador = jugadores.find(j => j.id === id);

    if (!jugador) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    res.json(jugador.historialTiers[gamemode]);
});

app.post('/api/players', requireAdmin, async (req, res) => {
    const { username, region } = req.body;

    console.log(`POST /api/players - Solicitado registrar al jugador "${username}".`);

    if (!username || !region) {
        return res.status(400).json({ error: 'Se requieren username y region' });
    }

    const regionUpper = region.toUpperCase();

    if (!REGIONES.includes(regionUpper)) {
        return res.status(400).json({
            error: `Región inválida. Debe ser una de: ${REGIONES.join(', ')}`
        });
    }

    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
        return res.status(400).json({
            error: 'El nombre de usuario de Minecraft no tiene un formato válido'
        });
    }

    const jugadores = leerJugadoresNormalizados();

    if (jugadores.some(j => j.username.toLowerCase() === username.toLowerCase())) {
        return res.status(409).json({
            error: 'Ese jugador ya está registrado en el tierlist'
        });
    }

    const datosMc = await obtenerDatosMinecraft(username);

    if (datosMc.existe === false) {
        return res.status(404).json({
            error: `No existe ninguna cuenta de Minecraft con el nombre "${username}"`
        });
    }

    const nuevoJugador = normalizarJugador({
        id: Date.now().toString(),
        username: datosMc.username,
        uuid: datosMc.uuid,
        region: regionUpper,
        skinHeadUrl: datosMc.skinHeadUrl,
        tiers: {
            sword: null,
            nethpot: null,
            uhc: null
        },
        historialTiers: {
            sword: [],
            nethpot: [],
            uhc: []
        },
        fechaRegistro: new Date().toISOString()
    });

    jugadores.push(nuevoJugador);

    if (!escribirArchivo(playersFile, jugadores)) {
        return res.status(500).json({ error: 'Error guardando al jugador' });
    }

    console.log(`POST /api/players - Jugador "${nuevoJugador.username}" registrado exitosamente.`);

    res.status(201).json({
        success: true,
        jugador: nuevoJugador
    });
});

app.patch('/api/players/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { region, refrescarSkin } = req.body;

    const jugadores = leerJugadoresNormalizados();
    const index = jugadores.findIndex(j => j.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    if (region) {
        const regionUpper = region.toUpperCase();

        if (!REGIONES.includes(regionUpper)) {
            return res.status(400).json({
                error: `Región inválida. Debe ser una de: ${REGIONES.join(', ')}`
            });
        }

        jugadores[index].region = regionUpper;
    }

    if (refrescarSkin) {
        const datosMc = await obtenerDatosMinecraft(jugadores[index].username);

        if (datosMc.username) {
            jugadores[index].username = datosMc.username;
        }

        if (datosMc.uuid) {
            jugadores[index].uuid = datosMc.uuid;
        }

        jugadores[index].skinHeadUrl = generarSkinHeadUrl(jugadores[index].username, 160);
    } else {
        jugadores[index].skinHeadUrl = generarSkinHeadUrl(jugadores[index].username, 160);
    }

    recalcularPuntos(jugadores[index]);

    if (!escribirArchivo(playersFile, jugadores)) {
        return res.status(500).json({ error: 'Error al actualizar al jugador' });
    }

    res.json({
        success: true,
        jugador: jugadores[index]
    });
});

app.patch('/api/players/:id/tier', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { gamemode, tier } = req.body;

    console.log(`PATCH /api/players/${id}/tier - Solicitado asignar tier "${tier}" en "${gamemode}".`);

    if (!gamemode || !GAMEMODES.includes(gamemode)) {
        return res.status(400).json({
            error: `Gamemode inválido. Debe ser uno de: ${GAMEMODES.join(', ')}`
        });
    }

    let tierNormalizado = null;

    if (tier !== null && tier !== undefined && tier !== '') {
        tierNormalizado = String(tier).toUpperCase();

        if (!TIERS_ORDEN.includes(tierNormalizado)) {
            return res.status(400).json({
                error: `Tier inválido. Debe ser uno de: ${TIERS_ORDEN.join(', ')} o null`
            });
        }
    }

    const jugadores = leerJugadoresNormalizados();
    const index = jugadores.findIndex(j => j.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    const jugador = jugadores[index];

    registrarCambioTier(jugador, gamemode, tierNormalizado);

    jugador.tiers[gamemode] = tierNormalizado;
    jugador.skinHeadUrl = generarSkinHeadUrl(jugador.username, 160);

    recalcularPuntos(jugador);

    if (!escribirArchivo(playersFile, jugadores)) {
        return res.status(500).json({ error: 'Error al asignar el tier' });
    }

    console.log(
        `PATCH /api/players/${id}/tier - Tier actualizado. Tier general ahora: ${jugador.tierGeneral} (${jugador.puntos.total} pts).`
    );

    res.json({
        success: true,
        jugador
    });
});

app.delete('/api/players/:id', requireAdmin, (req, res) => {
    const { id } = req.params;

    console.log(`DELETE /api/players/${id} - Solicitado.`);

    let jugadores = leerJugadoresNormalizados();
    const existe = jugadores.some(j => j.id === id);

    if (!existe) {
        return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    jugadores = jugadores.filter(j => j.id !== id);

    if (!escribirArchivo(playersFile, jugadores)) {
        return res.status(500).json({ error: 'Error al eliminar al jugador' });
    }

    console.log(`DELETE /api/players/${id} - Jugador eliminado exitosamente.`);

    res.json({ success: true });
});

// =====================================================================
// --- RUTAS: RANKING / LEADERBOARD ---
// =====================================================================

app.get('/api/leaderboard', (req, res) => {
    console.log('GET /api/leaderboard - Solicitado.');

    let jugadores = leerJugadoresNormalizados();

    const { region } = req.query;

    if (region) {
        jugadores = jugadores.filter(j => j.region === region.toUpperCase());
    }

    jugadores.sort((a, b) => {
        return b.puntos.total - a.puntos.total || a.username.localeCompare(b.username);
    });

    const ranking = jugadores.map((j, i) => ({
        posicion: i + 1,
        ...j
    }));

    res.json(ranking);
});

app.get('/api/leaderboard/:gamemode', (req, res) => {
    const { gamemode } = req.params;
    const { region } = req.query;

    console.log(`GET /api/leaderboard/${gamemode} - Solicitado.`);

    if (!GAMEMODES.includes(gamemode)) {
        return res.status(400).json({
            error: `Gamemode inválido. Debe ser uno de: ${GAMEMODES.join(', ')}`
        });
    }

    let jugadores = leerJugadoresNormalizados().filter(j => j.tiers[gamemode] !== null);

    if (region) {
        jugadores = jugadores.filter(j => j.region === region.toUpperCase());
    }

    jugadores.sort((a, b) => {
        const diff = TIERS_ORDEN.indexOf(a.tiers[gamemode]) - TIERS_ORDEN.indexOf(b.tiers[gamemode]);

        if (diff !== 0) return diff;

        return a.username.localeCompare(b.username);
    });

    const ranking = jugadores.map((j, i) => ({
        posicion: i + 1,
        id: j.id,
        username: j.username,
        region: j.region,
        skinHeadUrl: generarSkinHeadUrl(j.username, 160),
        tier: j.tiers[gamemode],
        puntos: j.puntos[gamemode]
    }));

    res.json(ranking);
});

// =====================================================================
// --- RUTAS: CUENTAS ---
// =====================================================================

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    console.log(`POST /api/login - Intento de login para el usuario "${username}".`);

    if (!username || !password) {
        return res.status(400).json({ error: 'Datos incompletos de cuenta.' });
    }

    const accounts = leerCuentasNormalizadas();
    const account = accounts.find(c => c.usuario === username && c.contraseña === password);

    if (!account) {
        console.warn(`POST /api/login - Login fallido para el usuario "${username}".`);

        return res.status(403).json({
            error: 'Usuario o contraseña incorrecto'
        });
    }

    if (account.banned) {
        console.warn(`POST /api/login - Usuario baneado: ${username}.`);

        return res.status(403).json({
            error: 'Tu cuenta ha sido suspendida. Contacta al administrador.'
        });
    }

    console.log(`POST /api/login - Login exitoso para el usuario "${username}".`);

    res.status(200).json({
        usuario: account.usuario,
        rol: account.rol,
        fotoPerfil: account.fotoPerfil,
        descripcion: account.descripcion
    });
});

app.post('/api/cuentas', (req, res) => {
    const { usuario, contraseña } = req.body;

    console.log(`POST /api/cuentas - Solicitud de registro para el usuario "${usuario}".`);

    if (!usuario || !contraseña) {
        return res.status(400).json({ error: 'Datos incompletos de cuenta' });
    }

    const cuentas = leerCuentasNormalizadas();

    if (cuentas.find(c => c.usuario === usuario)) {
        return res.status(409).json({
            success: false,
            message: 'Usuario ya existe'
        });
    }

    cuentas.push({
        usuario,
        contraseña,
        rol: 'usuario',
        banned: false,
        fotoPerfil: null,
        descripcion: ''
    });

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({ error: 'Error guardando cuenta' });
    }

    console.log(`POST /api/cuentas - Cuenta para "${usuario}" creada exitosamente.`);

    res.status(201).json({ success: true });
});

app.get('/api/cuentas', requireAdmin, (req, res) => {
    console.log('GET /api/cuentas - Solicitado.');

    const cuentas = leerCuentasNormalizadas();

    const cuentasSinPass = cuentas.map(c => ({
        usuario: c.usuario,
        rol: c.rol,
        banned: c.banned || false
    }));

    res.json(cuentasSinPass);
});

app.get('/api/cuentas/:usuario/perfil', (req, res) => {
    const { usuario } = req.params;
    const cuentas = leerCuentasNormalizadas();
    const cuenta = cuentas.find(c => c.usuario === usuario);

    if (!cuenta) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({
        usuario: cuenta.usuario,
        rol: cuenta.rol,
        fotoPerfil: cuenta.fotoPerfil,
        descripcion: cuenta.descripcion,
        banned: cuenta.banned
    });
});

app.patch('/api/cuentas/:usuario/foto-perfil', (req, res) => {
    const { usuario } = req.params;
    const { fotoPerfil } = req.body;

    if (fotoPerfil === undefined) {
        return res.status(400).json({ error: 'El campo fotoPerfil es requerido' });
    }

    const cuentas = leerCuentasNormalizadas();
    const index = cuentas.findIndex(c => c.usuario === usuario);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    cuentas[index].fotoPerfil = fotoPerfil;

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({ error: 'Error al actualizar foto de perfil' });
    }

    res.json({
        success: true,
        message: 'Foto de perfil actualizada correctamente',
        fotoPerfil
    });
});

app.patch('/api/cuentas/:usuario/descripcion', (req, res) => {
    const { usuario } = req.params;
    const { descripcion } = req.body;

    if (descripcion === undefined) {
        return res.status(400).json({ error: 'El campo descripcion es requerido' });
    }

    const cuentas = leerCuentasNormalizadas();
    const index = cuentas.findIndex(c => c.usuario === usuario);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    cuentas[index].descripcion = descripcion;

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({ error: 'Error al actualizar descripción' });
    }

    res.json({
        success: true,
        message: 'Descripción actualizada correctamente',
        descripcion
    });
});

app.patch('/api/cuentas/:usuario/contraseña', (req, res) => {
    const { usuario } = req.params;
    const { contraseñaActual, contraseñaNueva } = req.body;

    if (!contraseñaActual || !contraseñaNueva) {
        return res.status(400).json({
            error: 'Se requieren contraseñaActual y contraseñaNueva'
        });
    }

    const cuentas = leerCuentasNormalizadas();
    const index = cuentas.findIndex(c => c.usuario === usuario);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (cuentas[index].contraseña !== contraseñaActual) {
        return res.status(403).json({ error: 'La contraseña actual es incorrecta' });
    }

    cuentas[index].contraseña = contraseñaNueva;

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({ error: 'Error al cambiar contraseña' });
    }

    res.json({
        success: true,
        message: 'Contraseña cambiada correctamente'
    });
});

app.patch('/api/cuentas/:usuario/ban', requireAdmin, (req, res) => {
    const { usuario } = req.params;
    const { banned } = req.body;

    if (typeof banned !== 'boolean') {
        return res.status(400).json({
            error: 'El campo banned debe ser true o false'
        });
    }

    const cuentas = leerCuentasNormalizadas();
    const index = cuentas.findIndex(c => c.usuario === usuario);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    cuentas[index].banned = banned;

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({ error: 'Error al actualizar estado de ban' });
    }

    res.json({
        success: true,
        message: `Usuario ${banned ? 'baneado' : 'desbaneado'} correctamente`
    });
});

// =====================================================================
// --- GESTIÓN DE ROLES ROOT ---
// =====================================================================

app.post('/api/cuentas/:usuario/grant-admin', (req, res) => {
    const { usuario } = req.params;
    const { rootPassword } = req.body;

    if (!rootPassword) {
        return res.status(400).json({
            error: 'La contraseña de root es requerida'
        });
    }

    const cuentas = leerCuentasNormalizadas();
    const rootAccount = cuentas.find(c => c.usuario === 'root');

    if (!rootAccount) {
        return res.status(500).json({
            error: 'La cuenta root no existe en el sistema'
        });
    }

    if (rootAccount.contraseña !== rootPassword) {
        return res.status(403).json({
            error: 'Contraseña de root incorrecta'
        });
    }

    const index = cuentas.findIndex(c => c.usuario === usuario);

    if (index === -1) {
        return res.status(404).json({
            error: 'Usuario no encontrado'
        });
    }

    if (cuentas[index].rol === 'admin') {
        return res.status(409).json({
            error: 'El usuario ya es administrador'
        });
    }

    cuentas[index].rol = 'admin';

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({
            error: 'Error al otorgar rol de administrador'
        });
    }

    res.json({
        success: true,
        message: `Rol de administrador otorgado a ${usuario} correctamente`
    });
});

app.post('/api/cuentas/:usuario/revoke-admin', (req, res) => {
    const { usuario } = req.params;
    const { rootPassword } = req.body;

    if (!rootPassword) {
        return res.status(400).json({
            error: 'La contraseña de root es requerida'
        });
    }

    const cuentas = leerCuentasNormalizadas();
    const rootAccount = cuentas.find(c => c.usuario === 'root');

    if (!rootAccount) {
        return res.status(500).json({
            error: 'La cuenta root no existe en el sistema'
        });
    }

    if (rootAccount.contraseña !== rootPassword) {
        return res.status(403).json({
            error: 'Contraseña de root incorrecta'
        });
    }

    if (usuario === 'root') {
        return res.status(403).json({
            error: 'No se puede revocar el rol de administrador de la cuenta root'
        });
    }

    const index = cuentas.findIndex(c => c.usuario === usuario);

    if (index === -1) {
        return res.status(404).json({
            error: 'Usuario no encontrado'
        });
    }

    if (cuentas[index].rol !== 'admin') {
        return res.status(409).json({
            error: 'El usuario no es administrador'
        });
    }

    cuentas[index].rol = 'usuario';

    if (!escribirArchivo(cuentasFile, cuentas)) {
        return res.status(500).json({
            error: 'Error al revocar rol de administrador'
        });
    }

    res.json({
        success: true,
        message: `Rol de administrador revocado a ${usuario} correctamente`
    });
});

// =====================================================================
// --- INICIAR SERVIDOR ---
// =====================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor del Tierlist activo en puerto ${PORT}`);
});

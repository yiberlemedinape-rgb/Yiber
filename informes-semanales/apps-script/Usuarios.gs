/**
 * Usuarios.gs
 * ---------------------------------------------------------------------------
 * Control de acceso. La hoja "Usuario" (Cargo | Nombre | Correo) es la única
 * lista blanca del sistema: si un correo no está allí, la interfaz no muestra
 * ningún formulario.
 *
 * El correo se toma de la sesión de Google (Session.getActiveUser()), no de un
 * campo escrito por el usuario, de modo que no se puede suplantar a otro
 * colaborador desde la interfaz.
 * ---------------------------------------------------------------------------
 */

/** Libro activo (el mismo que contiene todas las hojas del ecosistema). */
function libro_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Lee la hoja "Usuario" completa. Devuelve [{cargo, nombre, correo, area}]. */
function listarUsuarios_() {
  var hoja = libro_().getSheetByName(CONFIG.HOJA_USUARIOS);
  if (!hoja) throw new Error('No existe la hoja "' + CONFIG.HOJA_USUARIOS + '".');

  var ultima = hoja.getLastRow();
  if (ultima < 2) return [];

  var filas = hoja.getRange(2, 1, ultima - 1, 3).getValues();
  var usuarios = [];

  for (var i = 0; i < filas.length; i++) {
    var cargo = texto_(filas[i][0]);
    var nombre = texto_(filas[i][1]);
    var correo = texto_(filas[i][2]).toLowerCase();
    if (!correo || !nombre) continue;
    usuarios.push({
      cargo: cargo,
      nombre: nombre,
      correo: correo,
      area: areaDeCargo_(cargo),
      esAdmin: esCargoAdmin_(cargo)
    });
  }
  return usuarios;
}

/**
 * ¿Este cargo otorga el rol de Administrador?
 *
 * El cargo debe *empezar* por una de las palabras de CARGOS_ADMIN, y esa palabra
 * tiene que terminar ahí. Exigir la palabra completa evita que "Administrativo"
 * o "Auxiliar administrativo" hereden por parecido el permiso de enviarle el
 * informe a la gerencia, y admitir un resto deja pasar "Administrador SAU".
 */
function esCargoAdmin_(cargo) {
  var normal = normalizar_(cargo);
  for (var i = 0; i < CARGOS_ADMIN.length; i++) {
    var palabra = CARGOS_ADMIN[i];
    if (normal === palabra) return true;
    if (normal.indexOf(palabra) === 0 &&
        /[^a-z0-9]/.test(normal.charAt(palabra.length))) return true;
  }
  return false;
}

/**
 * Traduce el "Cargo" escrito en la hoja Usuario al nombre de área del ESQUEMA.
 * Devuelve null si el cargo no corresponde a ningún formulario.
 */
function areaDeCargo_(cargo) {
  var normal = normalizar_(cargo);
  if (!normal) return null;

  // "Administrador" no es un área: quien lo tiene consolida lo que reportan las
  // demás. Si el cargo además nombra un área ("Administrador SAU"), se resuelve
  // por el resto, para que esa persona pueda seguir entregando su propio
  // reporte cuando CONFIG.ADMIN_TAMBIEN_REPORTA está activo.
  if (esCargoAdmin_(normal)) {
    normal = normal.replace(/^[a-z]+[\s\/,;.:·-]*/, '').trim();
    if (!normal) return null;
  }

  // 1) Coincidencia directa con el nombre del área.
  for (var area in ESQUEMA) {
    if (normalizar_(area) === normal) return area;
  }
  // 2) Alias conocidos.
  if (ALIAS_CARGOS[normal]) return ALIAS_CARGOS[normal];

  // 3) Coincidencia parcial (el cargo contiene el nombre del área).
  for (var area2 in ESQUEMA) {
    if (normal.indexOf(normalizar_(area2)) >= 0) return area2;
  }
  return null;
}

/** Correo del usuario autenticado (cadena vacía si Google no lo expone). */
function correoSesion_() {
  var correo = '';
  try { correo = Session.getActiveUser().getEmail() || ''; } catch (e) { correo = ''; }
  if (!correo) {
    try { correo = Session.getEffectiveUser().getEmail() || ''; } catch (e2) { correo = ''; }
  }
  return correo.toLowerCase();
}

/**
 * Resuelve al usuario autenticado contra la hoja "Usuario".
 * Devuelve { ok, motivo?, usuario? }.
 */
function usuarioActual_() {
  var correo = correoSesion_();
  if (!correo) {
    return {
      ok: false,
      motivo: 'No fue posible identificar tu cuenta de Google. Abre la ' +
              'aplicación con tu correo corporativo @kaeser.com y verifica que ' +
              'la implementación web esté configurada como "Ejecutar como: ' +
              'usuario que accede" o con acceso restringido al dominio.'
    };
  }

  var usuarios = listarUsuarios_();
  for (var i = 0; i < usuarios.length; i++) {
    if (usuarios[i].correo === correo) {
      var u = usuarios[i];
      // El Administrador entra sin área: su cargo no es un área que reporte,
      // sino el permiso para consolidar y enviar lo que reportan las demás.
      if (!u.area && !u.esAdmin) {
        return {
          ok: false,
          motivo: 'Tu cargo ("' + u.cargo + '") no está asociado a ningún ' +
                  'formulario. Solicita al administrador que lo corrija en la ' +
                  'hoja "' + CONFIG.HOJA_USUARIOS + '".'
        };
      }
      return { ok: true, usuario: u };
    }
  }

  return {
    ok: false,
    motivo: 'El correo ' + correo + ' no está registrado en la hoja "' +
            CONFIG.HOJA_USUARIOS + '". Solicita tu registro al administrador.'
  };
}

/** Correos cuyo cargo en la hoja "Usuario" es de Administrador. */
function correosAdmin_() {
  return listarUsuarios_()
    .filter(function (u) { return u.esAdmin; })
    .map(function (u) { return u.correo; });
}

/**
 * ¿Quien está ejecutando es el Administrador?
 *
 * El rol sale de la columna "Cargo" de la hoja "Usuario" y de ningún otro lado:
 * escribir "Administrador" en la fila de alguien le da el permiso, y cambiarle
 * el cargo a un área se lo quita y le devuelve su formulario. No hay listas de
 * correos paralelas, ni propiedades de script, ni excepciones para el
 * propietario del libro: una sola celda decide.
 *
 * Consecuencia deliberada: si NADIE tiene ese cargo, nadie puede disparar el
 * informe a mano. El envío automático del viernes no depende de esto —lo ejecuta
 * el disparador, no una persona—, así que la gerencia sigue recibiendo su
 * informe; lo que se pierde es el botón manual. "🔒 Verificar conexión con
 * Gemini" avisa cuando la hoja se queda sin ningún Administrador.
 */
function esAdministrador_() {
  var correo = correoSesion_();
  if (!correo) return false;
  return correosAdmin_().indexOf(correo) >= 0;
}

/** Lanza un error si quien ejecuta no es administrador. */
function exigirAdministrador_() {
  if (esAdministrador_()) return;
  throw new Error(
    'Sólo el Administrador puede ejecutar esta acción. El permiso se otorga en ' +
    'la hoja "' + CONFIG.HOJA_USUARIOS + '": escribe "' + CONFIG.CARGO_ADMIN +
    '" en la columna Cargo de la fila correspondiente al correo ' +
    (correoSesion_() || 'de esa persona') + '.');
}

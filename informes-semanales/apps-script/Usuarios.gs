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
      area: areaDeCargo_(cargo)
    });
  }
  return usuarios;
}

/**
 * Traduce el "Cargo" escrito en la hoja Usuario al nombre de área del ESQUEMA.
 * Devuelve null si el cargo no corresponde a ningún formulario.
 */
function areaDeCargo_(cargo) {
  var normal = normalizar_(cargo);
  if (!normal) return null;

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
      if (!u.area) {
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

/** Lista de correos administradores (propiedad ADMIN_CORREOS, separados por coma). */
function correosAdmin_() {
  var crudo = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.PROP_ADMINS) || '';
  return crudo.split(/[,;\s]+/)
    .map(function (c) { return c.trim().toLowerCase(); })
    .filter(function (c) { return c.length > 0; });
}

/** Correo del propietario del libro (cadena vacía si Google no lo expone). */
function correoPropietario_() {
  try {
    var duenio = libro_().getOwner();
    return duenio ? String(duenio.getEmail()).toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

/**
 * ¿Quien está ejecutando es el Administrador?
 *
 * El informe gerencial sólo puede dispararse a mano desde el menú de Google
 * Sheets, y sólo por un administrador. La interfaz web no expone esta acción
 * en absoluto (ver Code.gs: no existe ningún endpoint que la ejecute).
 *
 * Administrador = correo listado en ADMIN_CORREOS. Si esa propiedad todavía no
 * se ha configurado, se acepta únicamente al propietario del libro, para no
 * dejar el sistema sin nadie que pueda operarlo el primer día.
 */
function esAdministrador_() {
  var correo = correoSesion_();
  if (!correo) return false;

  var admins = correosAdmin_();
  if (admins.length) return admins.indexOf(correo) >= 0;

  var propietario = correoPropietario_();
  return propietario !== '' && propietario === correo;
}

/** Lanza un error si quien ejecuta no es administrador. */
function exigirAdministrador_() {
  if (esAdministrador_()) return;
  throw new Error(
    'Sólo el Administrador puede ejecutar esta acción. Agrega tu correo a la ' +
    'propiedad de script "' + CONFIG.PROP_ADMINS + '" ' +
    '(Configuración del proyecto → Propiedades del script).');
}

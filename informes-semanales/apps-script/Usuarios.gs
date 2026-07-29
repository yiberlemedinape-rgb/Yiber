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
function listarUsuarios() {
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
      area: areaDeCargo(cargo)
    });
  }
  return usuarios;
}

/**
 * Traduce el "Cargo" escrito en la hoja Usuario al nombre de área del ESQUEMA.
 * Devuelve null si el cargo no corresponde a ningún formulario.
 */
function areaDeCargo(cargo) {
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
function usuarioActual() {
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

  var usuarios = listarUsuarios();
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

/** ¿Este usuario puede previsualizar y enviar el informe gerencial? */
function puedeVerInforme_(usuario) {
  if (!usuario) return false;
  if (correosAdmin_().indexOf(usuario.correo) >= 0) return true;
  return CONFIG.CARGOS_CON_INFORME.indexOf(usuario.area) >= 0;
}

/** ¿Este usuario puede disparar el envío real del correo? */
function puedeEnviarInforme_(usuario) {
  if (!usuario) return false;
  var admins = correosAdmin_();
  // Si nadie configuró administradores, se permite a los cargos autorizados
  // para no bloquear la puesta en marcha.
  if (admins.length === 0) return CONFIG.CARGOS_CON_INFORME.indexOf(usuario.area) >= 0;
  return admins.indexOf(usuario.correo) >= 0;
}

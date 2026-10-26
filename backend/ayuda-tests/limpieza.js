// Limpieza de los tests de integración con PostgreSQL (no tiene tests propios).
//
// Borra usuarios de prueba y, antes, las notificaciones que les llegaron. Si otro
// test corre a la vez puede mandarles notificaciones: "Nuevo reporte para validar"
// o "Caso sin actualizar" van a TODOS los administradores de la base, también a los
// temporales de cada test. Sin borrarlas, la clave foránea impide borrar al usuario.
// Si una llega justo entre los dos DELETE, se reintenta.
// condicion: el WHERE sobre usuarios (p. ej. 'id = ANY($1)' o 'correo = $1').
export async function borrarUsuariosDePrueba(db, condicion, parametros) {
  for (let intento = 1; ; intento += 1) {
    try {
      await db.query(`DELETE FROM notificaciones WHERE usuario_id IN (SELECT id FROM usuarios WHERE ${condicion})`, parametros);
      await db.query(`DELETE FROM usuarios WHERE ${condicion}`, parametros);
      return;
    } catch (error) {
      const notificacionNueva = error.code === '23503' && error.constraint === 'notificaciones_usuario_id_fkey';
      if (!notificacionNueva || intento === 5) throw error;
    }
  }
}

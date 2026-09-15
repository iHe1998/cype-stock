/* ============================================================
   config.js · conexión por defecto a la base de máximos

   Esto es lo que evita que haya que configurar cada PC a mano. Poniendo
   acá los datos del proyecto de Supabase, cualquier máquina que abra la
   web toma los máximos sola: la del depósito, la de la tele y la tuya.

   Quien quiera apuntar a otra base igual puede: lo que se cargue en
   ⚙ Configuración manda sobre esto.

   ------------------------------------------------------------
   QUÉ VA ACÁ, Y QUÉ NO

   La clave que va acá es la **anónima** (anon / publishable), la que
   Supabase publica en el cliente a propósito. Con ella sólo se puede
   hacer lo que permitan las políticas RLS de la tabla, que son leer y
   nada más.

   NUNCA pongas acá la clave `service_role`. Esa saltea todas las
   políticas y da control total de la base. Va sólo en un servidor.
   ------------------------------------------------------------

   Ojo: el sitio es público, así que lo que se escriba acá lo puede leer
   cualquiera que abra la página. Con la anon key eso significa que
   podrían leer los máximos; escribir sigue necesitando sesión. Si eso
   no te sirve, dejá esto vacío y que cada PC lo cargue a mano.
   ============================================================ */
window.VLM = window.VLM || {};

VLM.config = {
  supabase: {
    url:     '',   // https://xxxxxxxxxxxx.supabase.co
    anonKey: ''    // la clave anon / publishable del proyecto
  }
};

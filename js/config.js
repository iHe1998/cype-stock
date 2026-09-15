/* ============================================================
   config.js · conexión por defecto a la base de stock y máximos

   Esto es lo que evita que haya que configurar cada PC a mano. Con los
   datos del proyecto de Supabase acá, cualquier máquina que abra la web
   toma el stock y los máximos sola: la del depósito, la de la tele y la
   tuya.

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

   Ojo: el sitio es público, así que esta clave la puede leer cualquiera
   que abra la página, y con ella podría leer el stock y los máximos.
   Escribir sigue necesitando sesión. Cuando el sitio quede detrás de
   Cloudflare Access, eso también se cierra.
   ============================================================ */
window.VLM = window.VLM || {};

VLM.config = {
  supabase: {
    url:     'https://iwryytorsdsziaqbmcnb.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cnl5dG9yc2RzemlhcWJtY25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTM4NTUsImV4cCI6MjEwNTA2OTg1NX0.SZd33nwO2O0adoZwBJKsBAyRaLz5afHEQNXyrxXGed8'
  }
};

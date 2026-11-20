const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY)
    return Response.json({ error: 'Acceso no autorizado' }, { status: 401 });
  if (!env.ALBUM_FOTOS)
    return Response.json({ error: 'Almacenamiento no configurado' }, { status: 503 });
  try {
    const { id, maxFotos, maxVideos } = await request.json();
    if (typeof id !== 'string' || !UUID.test(id) ||
        !Number.isInteger(maxFotos) || maxFotos < 1 || maxFotos > 2000 ||
        !Number.isInteger(maxVideos) || maxVideos < 0 || maxVideos > 100)
      return Response.json({ error: 'Datos inválidos' }, { status: 400 });
    const key = `config/albumes/${id}.json`;
    const obj = await env.ALBUM_FOTOS.get(key);
    if (!obj) return Response.json({ error: 'Álbum no encontrado' }, { status: 404 });
    const album = await obj.json();
    if (album.id !== id) return Response.json({ error: 'Identificador inconsistente' }, { status: 409 });
    await env.ALBUM_FOTOS.put(key, JSON.stringify({ ...album, maxFotos, maxVideos }),
      { httpMetadata: { contentType: 'application/json' } });
    return Response.json({ correcto: true, maxFotos, maxVideos });
  } catch (error) {
    console.error('Actualizar límites:', error);
    return Response.json({ error: 'No se pudieron actualizar los límites' }, { status: 500 });
  }
}

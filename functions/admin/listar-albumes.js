
export async function onRequestGet({ request, env }) {
  const clave = request.headers.get("X-Admin-Key");

  if (!env.ADMIN_KEY || !clave || clave !== env.ADMIN_KEY) {
    return Response.json(
      { error: "Acceso no autorizado" },
      { status: 401 }
    );
  }

  if (!env.ALBUM_FOTOS) {
    return Response.json(
      { error: "Almacenamiento no configurado" },
      { status: 503 }
    );
  }

  try {
    const albumes = [];
    let cursor;

    do {
      const pagina = await env.ALBUM_FOTOS.list({
        prefix: "config/albumes/",
        cursor
      });

      for (const archivo of pagina.objects) {
        if (!archivo.key.endsWith(".json")) continue;

        const objeto = await env.ALBUM_FOTOS.get(archivo.key);
        if (!objeto) continue;

        const album = await objeto.json();

        if (!album.id || !album.clave) continue;

        const url = new URL(request.url);
        const enlace = `${url.origin}/?evento=${encodeURIComponent(album.id)}&clave=${encodeURIComponent(album.clave)}`;

        albumes.push({
          id: album.id,
          nombre: album.nombre,
          fecha: album.fecha,
          finAlbum: album.finAlbum,
          maxFotos: album.maxFotos ?? 300,
          maxVideos: album.maxVideos ?? 10,
          enlace
        });
      }

      cursor = pagina.truncated ? pagina.cursor : undefined;
    } while (cursor);

    albumes.sort((a, b) =>
      (b.fecha || "").localeCompare(a.fecha || "")
    );

    return Response.json({ correcto: true, albumes });
  } catch (error) {
    console.error("Error al listar álbumes:", error);

    return Response.json(
      { error: "No se pudieron consultar los álbumes" },
      { status: 500 }
    );
  }
}

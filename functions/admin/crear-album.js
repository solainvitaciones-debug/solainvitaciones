
export async function onRequestPost({ request, env }) {
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
    const datos = await request.json();
    const nombre = String(datos.nombre || "").trim();
    const fecha = String(datos.fecha || "");

    if (
      nombre.length < 3 ||
      nombre.length > 120 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      !Number.isFinite(Date.parse(fecha + "T12:00:00Z"))
    ) {
      return Response.json(
        { error: "Nombre o fecha inválidos" },
        { status: 400 }
      );
    }

    if (fecha < new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })) {
      return Response.json({error:"La fecha del evento no puede ser anterior a hoy"},{status:400});
    }
    const id = crypto.randomUUID();
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const claveAlbum = Array.from(bytes, b =>
      b.toString(16).padStart(2, "0")
    ).join("");

    const fechaEvento = new Date(fecha + "T12:00:00-03:00");
    const cierreCarga = new Date(fechaEvento);
    cierreCarga.setUTCDate(cierreCarga.getUTCDate() + 3);

    // El álbum vence al comenzar el día 31 posterior al evento (Argentina).
    // Coincide con el cálculo del Worker de limpieza programada.
    const finAlbum = new Date(`${fecha}T00:00:00-03:00`);
    finAlbum.setUTCDate(finAlbum.getUTCDate() + 31);

    const album = {
      id,
      nombre,
      fecha,
      clave: claveAlbum,
      cierreCarga: cierreCarga.toISOString(),
      finAlbum: finAlbum.toISOString(),
      maxFotos: 300,
      maxVideos: 10,
      creado: new Date().toISOString()
    };

    await env.ALBUM_FOTOS.put(
      `config/albumes/${id}.json`,
      JSON.stringify(album),
      {
        httpMetadata: {
          contentType: "application/json"
        }
      }
    );

    const url = new URL(request.url);
    const enlace =
      `${url.origin}/?evento=${encodeURIComponent(id)}` +
      `&clave=${encodeURIComponent(claveAlbum)}`;

    return Response.json({
      correcto: true,
      nombre,
      fecha,
      enlace
    });
  } catch {
    return Response.json(
      { error: "No se pudo crear el álbum" },
      { status: 500 }
    );
  }
}

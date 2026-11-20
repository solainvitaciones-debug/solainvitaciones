
import { buscarEvento } from "./_eventos.js";

const MAX_MENSAJES = 500;
const MAX_NOMBRE = 80;
const MAX_TEXTO = 1000;

export async function onRequestGet({ request, env }) {
  if (!env.ALBUM_FOTOS) {
    return Response.json({ error: "Almacenamiento no disponible" }, { status: 503 });
  }

  const evento = await buscarEvento(request, env);
  if (!evento) {
    return Response.json({ error: "Álbum no autorizado" }, { status: 403 });
  }

  const prefix = `mensajes/${evento.id}/`;
  const mensajes = [];
  let cursor;

  do {
    const pagina = await env.ALBUM_FOTOS.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });

    for (const archivo of pagina.objects) {
      if (!archivo.key.endsWith(".json")) continue;
      const objeto = await env.ALBUM_FOTOS.get(archivo.key);
      if (!objeto) continue;

      const mensaje = await objeto.json();
      mensajes.push({
        id: archivo.key.slice(prefix.length, -5),
        nombre: mensaje.nombre,
        texto: mensaje.texto,
        fecha: mensaje.fecha
      });
    }

    cursor = pagina.truncated ? pagina.cursor : undefined;
  } while (cursor);

  mensajes.sort((a, b) => a.fecha.localeCompare(b.fecha));

  return Response.json({ mensajes }, {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.ALBUM_FOTOS) {
    return Response.json({ error: "Almacenamiento no disponible" }, { status: 503 });
  }

  const evento = await buscarEvento(request, env);
  if (!evento) {
    return Response.json({ error: "Álbum no autorizado" }, { status: 403 });
  }

  if (evento.cierreCarga && Date.now() >= Date.parse(evento.cierreCarga)) {
    return Response.json({ error: "La recepción de mensajes está cerrada" }, { status: 403 });
  }

  let datos;
  try {
    datos = await request.json();
  } catch {
    return Response.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const nombre = String(datos.nombre ?? "").trim();
  const texto = String(datos.texto ?? "").trim();

  if (!nombre || nombre.length > MAX_NOMBRE ||
      !texto || texto.length > MAX_TEXTO) {
    return Response.json({ error: "Revisá el nombre y el mensaje" }, { status: 400 });
  }

  const prefix = `mensajes/${evento.id}/`;
  const pagina = await env.ALBUM_FOTOS.list({
    prefix,
    limit: MAX_MENSAJES
  });

  if (pagina.objects.length >= MAX_MENSAJES || pagina.truncated) {
    return Response.json({ error: "Se alcanzó el límite de mensajes" }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const fecha = new Date().toISOString();

  await env.ALBUM_FOTOS.put(
    `${prefix}${id}.json`,
    JSON.stringify({ nombre, texto, fecha }),
    { httpMetadata: { contentType: "application/json" } }
  );

  return Response.json({ correcto: true, id, fecha });
}

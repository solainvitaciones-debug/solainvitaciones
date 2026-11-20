
import { buscarEvento } from "./_eventos.js";

const fail = (mensaje, estado) =>
  Response.json(
    { error: mensaje },
    { status: estado, headers: { "Cache-Control": "no-store" } }
  );

export async function onRequestPost({ request, env }) {
  const evento = await buscarEvento(request, env);
  if (!evento) return fail("Álbum no disponible", 404);

  if (!env.ALBUM_FOTOS) {
    return fail("Almacenamiento no disponible", 503);
  }

  const clave = request.headers.get("X-Pareja-Key") || "";

  if (!/^[a-f0-9]{48}$/i.test(clave)) {
    return fail("Clave privada inválida", 403);
  }

  const config = await env.ALBUM_FOTOS.get(
    `config/albumes/${evento.id}.json`
  );

  if (!config) return fail("Álbum no encontrado", 404);

  const album = await config.json();

  if (
    typeof album.claveParejaHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(album.claveParejaHash)
  ) {
    return fail("Primero configurá el acceso del organizador", 403);
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(clave)
  );

  const hash = Array.from(
    new Uint8Array(digest),
    b => b.toString(16).padStart(2, "0")
  ).join("");

  let diferencia = 0;

  for (let i = 0; i < 64; i++) {
    diferencia |=
      hash.charCodeAt(i) ^
      album.claveParejaHash.toLowerCase().charCodeAt(i);
  }

  if (diferencia) {
    return fail("Clave privada incorrecta", 403);
  }

  const datos = await request.json().catch(() => ({}));
  const id = datos.id;

  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
  ) {
    return fail("Mensaje inválido", 400);
  }

  const ruta = `mensajes/${evento.id}/${id}.json`;
  const existente = await env.ALBUM_FOTOS.head(ruta);

  if (!existente) {
    return fail("Mensaje no encontrado", 404);
  }

  await env.ALBUM_FOTOS.delete(ruta);

  return Response.json(
    { correcto: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}

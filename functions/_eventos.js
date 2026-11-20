// CONFIGURACIÓN PRIVADA: no colocar este archivo fuera de functions.
export const EVENTOS = {
  "juana-benja": { nombre: "Juana & Benja", fecha: "2026-11-15", cierreCarga: "2026-11-18T00:00:00-03:00",acceso: "12345ABCDE12345abcde12345" },
  "sofia-15": { nombre: "Sofía · Mis 15", fecha: "2026-12-05", cierreCarga: "2026-12-08T00:00:00-03:00", acceso: "15ABC15abc15ABC15abc15ABC" }
};
export function eventoAutorizado(request) {
  const u = new URL(request.url);
  const id = u.searchParams.get('evento') || '';
  const clave = u.searchParams.get('clave') || '';
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return null;
  const e = EVENTOS[id];
  return e && clave === e.acceso ? {id, ...e} : null;
}
export async function buscarEvento(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get("evento");
  const clave = url.searchParams.get("clave");

  if (!id || !clave) return null;

  // Primero comprobar los álbumes existentes.
  const existente = eventoAutorizado(request);
  if (existente) return existente;

  // Buscar álbumes nuevos en Cloudflare R2.
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  if (!env.ALBUM_FOTOS) return null;

  const objeto = await env.ALBUM_FOTOS.get(
    `config/albumes/${id}.json`
  );

  if (!objeto) return null;

  const album = await objeto.json();

  if (album.clave !== clave) return null;
  if (album.finAlbum && Date.now() >= Date.parse(album.finAlbum)) return null;

  return {
    id: album.id,
    nombre: album.nombre,
    fecha: album.fecha,
    cierreCarga: album.cierreCarga,
    finAlbum: album.finAlbum,
    clave: album.clave,
    maxFotos: album.maxFotos ?? 300,
    maxVideos: album.maxVideos ?? 10
  };
}


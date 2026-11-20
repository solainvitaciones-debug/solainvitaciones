import { buscarEvento } from './_eventos.js';

export async function onRequestGet({ request, env }) {
  const evento = await buscarEvento(request, env);
  if (!evento) return new Response('Álbum no disponible', { status: 404 });
  if (!env.ALBUM_FOTOS) return new Response('R2 no conectado', { status: 503 });
  const url = new URL(request.url);
  const nombre = url.searchParams.get('nombre');
  if (!/^[a-f0-9-]{36}\.mp4$/i.test(nombre || '')) return new Response('Archivo inválido', { status: 400 });
  const key = `eventos/${evento.id}/videos/${nombre}`;
  const metadata = await env.ALBUM_FOTOS.head(key);
  if (!metadata) return new Response('Video no encontrado', { status: 404 });
  const total = metadata.size;
  const range = request.headers.get('Range');
  let start = 0, end = total - 1, partial = false;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
      start = Math.max(0, total - suffix);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), total - 1);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    partial = true;
  }
  const length = end - start + 1;
  const objeto = await env.ALBUM_FOTOS.get(key, { range: { offset: start, length } });
  if (!objeto?.body) return new Response('Video no encontrado', { status: 404 });
  const headers = {
    'Content-Type': 'video/mp4',
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private,max-age=60',
    'X-Content-Type-Options': 'nosniff',
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
    ...(url.searchParams.get('descargar') === '1' ? { 'Content-Disposition': `attachment; filename="${nombre}"` } : {})
  };
  return new Response(objeto.body, { status: partial ? 206 : 200, headers });
}

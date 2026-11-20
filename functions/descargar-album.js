
import { buscarEvento } from './_eventos.js';

const fail = (message, status) =>
  Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });

const photo = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(jpg|png|webp)$/i;
const video = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.mp4$/i;

const enc = new TextEncoder();
const u16 = (a, n) => { a.push(n & 255, (n >>> 8) & 255); };
const u32 = (a, n) => {
  a.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
};
const bytes = a => new Uint8Array(a);

const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crcUpdate(crc, chunk) {
  for (const b of chunk) {
    crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function stamp(date) {
  const d = new Date(date || Date.now());
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    t: (d.getUTCHours() << 11) |
       (d.getUTCMinutes() << 5) |
       (d.getUTCSeconds() >> 1),
    d: ((year - 1980) << 9) |
       ((d.getUTCMonth() + 1) << 5) |
       d.getUTCDate()
  };
}

async function listarTodo(bucket, prefix) {
  const archivos = [];
  let cursor;

  do {
    const pagina = await bucket.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });

    archivos.push(...pagina.objects);

    if (pagina.truncated && !pagina.cursor) {
      throw Error('No se pudo completar la lista de archivos');
    }

    cursor = pagina.truncated ? pagina.cursor : undefined;
  } while (cursor);

  return archivos;
}

export async function onRequestPost({ request, env }) {
  const evento = await buscarEvento(request, env);
  if (!evento) return fail('Álbum no disponible', 404);

  if (!env.ALBUM_FOTOS) {
    return fail('Almacenamiento no disponible', 503);
  }

  const clave = request.headers.get('X-Pareja-Key') || '';
  if (!/^[a-f0-9]{48}$/i.test(clave)) {
    return fail('Clave privada inválida', 403);
  }

  const config = await env.ALBUM_FOTOS.get(
    `config/albumes/${evento.id}.json`
  );

  if (!config) return fail('Álbum no encontrado', 404);

  const album = await config.json();

  if (!/^[a-f0-9]{64}$/i.test(album.claveParejaHash || '')) {
    return fail('Acceso del organizador no configurado', 403);
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(clave)
  );

  const hash = Array.from(
    new Uint8Array(digest),
    b => b.toString(16).padStart(2, '0')
  ).join('');

  let mismatch = 0;
  for (let i = 0; i < 64; i++) {
    mismatch |= hash.charCodeAt(i) ^
                album.claveParejaHash.charCodeAt(i);
  }

  if (mismatch) {
    return fail('Clave privada incorrecta', 403);
  }

  const files = [];

  const objetos = await listarTodo(
    env.ALBUM_FOTOS,
    `eventos/${evento.id}/`
  );

  for (const obj of objetos) {
    const name = obj.key.split('/').pop();
    const isPhoto = photo.test(name);
    const isVideo = video.test(name);

    if (isPhoto || isVideo) {
      files.push({
        key: obj.key,
        name: (isVideo ? 'Videos/' : 'Fotos/') + name,
        date: obj.uploaded
      });
    }
  }

  // Incorporar las dedicatorias de los invitados.
  const mensajesObjetos = await listarTodo(
    env.ALBUM_FOTOS,
    `mensajes/${evento.id}/`
  );

  const mensajes = [];

  for (const obj of mensajesObjetos) {
    if (!/^[a-f0-9-]{36}\.json$/i.test(
      obj.key.split('/').pop()
    )) continue;

    const archivo = await env.ALBUM_FOTOS.get(obj.key);
    if (!archivo) continue;

    const mensaje = await archivo.json();

    mensajes.push({
      nombre: String(mensaje.nombre ?? ''),
      texto: String(mensaje.texto ?? ''),
      fecha: String(mensaje.fecha ?? '')
    });
  }

  mensajes.sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (mensajes.length) {
    const lineas = [
      'SOLA INVITACIONES',
      'LIBRO DE MENSAJES',
      '',
      `Evento: ${album.nombre || 'Evento'}`,
      `Total de mensajes: ${mensajes.length}`,
      '',
      '========================================',
      ''
    ];

    for (const mensaje of mensajes) {
      const fecha = new Date(mensaje.fecha);
      const fechaTexto = Number.isNaN(fecha.getTime())
        ? mensaje.fecha
        : fecha.toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires'
          });

      lineas.push(
        `De: ${mensaje.nombre}`,
        `Fecha: ${fechaTexto}`,
        '',
        mensaje.texto,
        '',
        '----------------------------------------',
        ''
      );
    }

    // BOM UTF-8 para mostrar correctamente las tildes
    // y las eñes en el Bloc de notas de Windows.
    const contenido = enc.encode(
      '\uFEFF' + lineas.join('\r\n')
    );

    files.push({
      name: 'Mensajes.txt',
      content: contenido,
      date: new Date()
    });
  }

  if (!files.length) {
    return fail(
      'El álbum no contiene archivos ni mensajes para descargar',
      404
    );
  }

  files.sort((a, b) => a.name.localeCompare(b.name));

  // ZIP sin compresión: transmite fotos y videos por partes.
  const stream = new ReadableStream({
    async start(controller) {
      let offset = 0;
      const central = [];

      const send = b => {
        controller.enqueue(b);
        offset += b.byteLength;
      };

      try {
        for (const f of files) {
          const filename = enc.encode(f.name);
          const { t, d } = stamp(f.date);
          const start = offset;

          const h = [80, 75, 3, 4];
          u16(h, 20);
          u16(h, 0x808);
          u16(h, 0);
          u16(h, t);
          u16(h, d);
          u32(h, 0);
          u32(h, 0);
          u32(h, 0);
          u16(h, filename.length);
          u16(h, 0);

          send(bytes(h));
          send(filename);

          let crc = 0xffffffff;
          let size = 0;

          if (f.content) {
            crc = crcUpdate(crc, f.content);
            size = f.content.byteLength;
            send(f.content);
          } else {
            const object = await env.ALBUM_FOTOS.get(f.key);

            if (!object?.body) {
              throw Error('Falta un archivo durante la descarga');
            }

            const reader = object.body.getReader();

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                crc = crcUpdate(crc, value);
                size += value.byteLength;
                send(value);
              }
            } finally {
              reader.releaseLock();
            }
          }

          crc = (crc ^ 0xffffffff) >>> 0;

          const desc = [80, 75, 7, 8];
          u32(desc, crc);
          u32(desc, size);
          u32(desc, size);
          send(bytes(desc));

          const c = [80, 75, 1, 2];
          u16(c, 20);
          u16(c, 20);
          u16(c, 0x808);
          u16(c, 0);
          u16(c, t);
          u16(c, d);
          u32(c, crc);
          u32(c, size);
          u32(c, size);
          u16(c, filename.length);
          u16(c, 0);
          u16(c, 0);
          u16(c, 0);
          u16(c, 0);
          u32(c, 0);
          u32(c, start);

          central.push({
            head: bytes(c),
            filename
          });
        }

        const centralStart = offset;

        for (const c of central) {
          send(c.head);
          send(c.filename);
        }

        const centralSize = offset - centralStart;

        const end = [80, 75, 5, 6];
        u16(end, 0);
        u16(end, 0);
        u16(end, central.length);
        u16(end, central.length);
        u32(end, centralSize);
        u32(end, centralStart);
        u16(end, 0);

        send(bytes(end));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });

  const safe = (album.nombre || 'Evento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 60) || 'Evento';

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition':
        `attachment; filename="Album-${safe}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

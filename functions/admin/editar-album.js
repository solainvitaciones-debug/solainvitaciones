const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === fecha;
}
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) return Response.json({error:'Acceso no autorizado'},{status:401});
  if (!env.ALBUM_FOTOS) return Response.json({error:'Almacenamiento no configurado'},{status:503});
  try {
    const {id, nombre, fecha} = await request.json();
    if (!UUID.test(id || '') || typeof nombre !== 'string' || nombre.trim().length < 3 || nombre.trim().length > 120 || !fechaValida(fecha || '')) return Response.json({error:'Datos inválidos'},{status:400});
    const key = `config/albumes/${id}.json`;
    const obj = await env.ALBUM_FOTOS.get(key);
    if (!obj) return Response.json({error:'Álbum no encontrado'},{status:404});
    const album = await obj.json();
    if (album.id !== id) return Response.json({error:'Identificador inconsistente'},{status:409});
    const evento = new Date(`${fecha}T12:00:00-03:00`);
    const cierreCarga = new Date(evento.getTime() + 3*86400000).toISOString();
    const finAlbum = new Date(evento.getTime() + 30*86400000).toISOString();
    await env.ALBUM_FOTOS.put(key, JSON.stringify({...album,nombre:nombre.trim(),fecha,cierreCarga,finAlbum}), {httpMetadata:{contentType:'application/json'}});
    return Response.json({correcto:true});
  } catch (e) { console.error('Editar álbum:',e); return Response.json({error:'No se pudo editar el álbum'},{status:500}); }
}

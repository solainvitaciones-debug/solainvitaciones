const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function listar(bucket, prefix) {
  const result=[]; let cursor;
  do {
    const p=await bucket.list({prefix,limit:1000,...(cursor?{cursor}:{})});
    result.push(...p.objects.map(o=>o.key));
    if(p.truncated&&!p.cursor) throw new Error('Paginación incompleta');
    cursor=p.truncated?p.cursor:undefined;
  } while(cursor);
  if(result.some(k=>!k.startsWith(prefix))) throw new Error('Prefijo inesperado');
  return result;
}
export async function onRequestPost({request,env}) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) return Response.json({error:'Acceso no autorizado'},{status:401});
  if (!env.ALBUM_FOTOS) return Response.json({error:'Almacenamiento no configurado'},{status:503});
  try {
    const {id,confirmacion}=await request.json();
    if(!UUID.test(id||'')||confirmacion!=='ELIMINAR') return Response.json({error:'Confirmación inválida'},{status:400});
    const key=`config/albumes/${id}.json`;
    const obj=await env.ALBUM_FOTOS.get(key);
    if(!obj) return Response.json({error:'Álbum no encontrado'},{status:404});
    const album=await obj.json();
    if(album.id!==id) return Response.json({error:'Identificador inconsistente'},{status:409});
    const fotos=await listar(env.ALBUM_FOTOS,`eventos/${id}/`);
    const mensajes=await listar(env.ALBUM_FOTOS,`mensajes/${id}/`);
    const claves=[...fotos,...mensajes];
    for(let i=0;i<claves.length;i+=100) await env.ALBUM_FOTOS.delete(claves.slice(i,i+100));
    const restantes=[...await listar(env.ALBUM_FOTOS,`eventos/${id}/`),...await listar(env.ALBUM_FOTOS,`mensajes/${id}/`)];
    if(restantes.length) throw new Error('Quedan archivos pendientes');
    await env.ALBUM_FOTOS.delete(key);
    return Response.json({correcto:true,archivosEliminados:claves.length});
  } catch(e) {console.error('Eliminar álbum:',e);return Response.json({error:'No se pudo completar la eliminación; revisá los registros antes de reintentar'},{status:500});}
}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function onRequestPost({request,env}) {
 if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return Response.json({error:'Acceso no autorizado'},{status:401});
 if(!env.ALBUM_FOTOS)return Response.json({error:'R2 no conectado'},{status:503});
 const {id}=await request.json().catch(()=>({}));if(!uuid.test(id||''))return Response.json({error:'Álbum inválido'},{status:400});
 const key=`config/albumes/${id}.json`,obj=await env.ALBUM_FOTOS.get(key);if(!obj)return Response.json({error:'Álbum no encontrado'},{status:404});
 const album=await obj.json();if(album.id!==id)return Response.json({error:'Identificador inválido'},{status:400});
 const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);const clavePareja=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 // Solo se almacena hash, nunca la clave en texto plano.
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(clavePareja));
 album.claveParejaHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 await env.ALBUM_FOTOS.put(key,JSON.stringify(album),{httpMetadata:{contentType:'application/json'}});
 return Response.json({clavePareja},{headers:{'Cache-Control':'no-store'}});
}

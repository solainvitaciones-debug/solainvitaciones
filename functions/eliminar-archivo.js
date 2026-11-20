import {buscarEvento} from './_eventos.js';
const foto=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
const video=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$/i;
const fail=(msg,status)=>Response.json({error:msg},{status,headers:{'Cache-Control':'no-store'}});
export async function onRequestPost({request,env}) {
 const evento=await buscarEvento(request,env);if(!evento)return fail('Álbum no disponible',404);
 if(!env.ALBUM_FOTOS)return fail('Almacenamiento no disponible',503);
 const clave=request.headers.get('X-Pareja-Key')||'';
 if(!clave||!/^[a-f0-9]{48}$/i.test(clave))return fail('Clave privada inválida',403);
 const config=await env.ALBUM_FOTOS.get(`config/albumes/${evento.id}.json`);
 if(!config)return fail('Álbum no encontrado',404);
 const album=await config.json();if(!album.claveParejaHash)return fail('Primero configurá el acceso del organizador',403);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(clave));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 // Comparación de longitud fija.
 let mismatch=0;for(let i=0;i<64;i++)mismatch|=hash.charCodeAt(i)^album.claveParejaHash.charCodeAt(i);
 if(mismatch)return fail('Clave privada incorrecta',403);
 const datos=await request.json().catch(()=>({}));const tipo=datos.tipo,nombre=datos.nombre;
 if(typeof nombre!=='string'||!(tipo==='foto'?foto.test(nombre):tipo==='video'&&video.test(nombre)))return fail('Archivo inválido',400);
 const key=`eventos/${evento.id}/${tipo==='video'?'videos/':''}${nombre}`;
 const obj=await env.ALBUM_FOTOS.head(key);if(!obj)return fail('Archivo no encontrado',404);
 await env.ALBUM_FOTOS.delete(key);
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}

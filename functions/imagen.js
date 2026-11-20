import { buscarEvento } from './_eventos.js';

export async function onRequestGet({request,env}){
 const evento = await buscarEvento(request,env);
if (!evento) return new Response('Álbum no disponible', {status: 404});
 const bucket=env.ALBUM_FOTOS;if(!bucket)return new Response('Almacenamiento no disponible',{status:500});
 const nombre=new URL(request.url).searchParams.get('nombre');
 if(!nombre||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(nombre))return new Response('Nombre de imagen inválido',{status:400});
 const objeto=await bucket.get(`eventos/${evento.id}/${nombre}`);
 if(!objeto)return new Response('Imagen no encontrada',{status:404});
 const descargar=new URL(request.url).searchParams.get('descargar')==='1';
 return new Response(objeto.body,{headers:{'Content-Type':objeto.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff',...(descargar?{'Content-Disposition':`attachment; filename="${nombre}"`}:{})}});
}

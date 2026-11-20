import { buscarEvento } from './_eventos.js';
const regexFoto = /^[a-f0-9-]{36}\.(jpg|png|webp)$/i;
function error(mensaje,status){return Response.json({error:mensaje},{status})}
export async function onRequestGet({request,env}){
 const evento=await buscarEvento(request,env);if(!evento)return error("Álbum no disponible",404);
 const bucket=env.ALBUM_FOTOS;if(!bucket)return error('R2 no conectado',500);
 const fotos=[];let cursor;
 do{const r=await bucket.list({prefix:`eventos/${evento.id}/`,limit:100,...(cursor?{cursor}:{})});
 for(const o of r.objects){const nombre=o.key.split('/').pop();if(regexFoto.test(nombre))fotos.push({nombre,url:`/imagen?evento=${encodeURIComponent(evento.id)}&clave=${encodeURIComponent((evento.acceso || evento.clave)
)}&nombre=${encodeURIComponent(nombre)}`,fecha:o.uploaded?.toISOString()||''})}
 cursor=r.truncated?r.cursor:undefined}while(cursor);
 fotos.sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.nombre.localeCompare(b.nombre));
 return Response.json({nombreEvento:evento.nombre,fechaEvento:evento.fecha,maxFotos:evento.maxFotos??300,maxVideos:evento.maxVideos??10,fotos:fotos.map(({nombre,url})=>({nombre,url}))},{headers:{'Cache-Control':'no-store'}});
}
export async function onRequestPost({request,env}){
 const evento=await buscarEvento(request,env);if(!evento)return error("Álbum no disponible",404);
 const bucket=env.ALBUM_FOTOS;if(!bucket)return error('R2 no conectado',500);
 if(Date.now()>=Date.parse(evento.cierreCarga))return error('La recepción de fotografías de este evento ha finalizado.',403);
 const tipo=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 const formatos={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 if(!formatos[tipo])return error('Solo se permiten fotografías JPG, PNG o WebP.',415);
 const max=20*1024*1024;const longitud=Number(request.headers.get('content-length'));
 if(longitud>max)return error('La fotografía no puede superar los 20 MB.',413);
 const archivo=await request.arrayBuffer();if(!archivo.byteLength||archivo.byteLength>max)return error('La fotografía debe pesar entre 1 byte y 20 MB.',413);
 const b=new Uint8Array(archivo);
 if(tipo==='image/jpeg'&&!(b[0]===255&&b[1]===216&&b[2]===255))return error('JPG inválido.',415);
 if(tipo==='image/png'&&!(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10))return error('PNG inválido.',415);
 if(tipo==='image/webp'&&!(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'))return error('WebP inválido.',415);
 let total=0,cursor;
 do {const page=await bucket.list({prefix:`eventos/${evento.id}/`,cursor});
   total+=page.objects.filter(o=>regexFoto.test(o.key.split('/').pop())).length;
   cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 if(total >= (evento.maxFotos??300))return error('Se alcanzó el límite de fotografías.',409);
 const nombre=`${crypto.randomUUID()}.${formatos[tipo]}`;
 await bucket.put(`eventos/${evento.id}/${nombre}`,archivo,{httpMetadata:{contentType:tipo}});
 return Response.json({ok:true,nombre},{status:201});
}

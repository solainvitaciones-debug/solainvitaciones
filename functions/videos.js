import { buscarEvento } from './_eventos.js';
const regex=/^[a-f0-9-]{36}\.(mp4|mov|webm)$/i;
const error=(msg,status)=>Response.json({error:msg},{status});
export async function onRequestGet({request,env}) {
 const evento=await buscarEvento(request,env);if(!evento)return error('Álbum no disponible',404);
 const bucket=env.ALBUM_FOTOS;if(!bucket)return error('R2 no conectado',503);
 const videos=[];let cursor;
 do {const page=await bucket.list({prefix:`eventos/${evento.id}/videos/`,cursor});
   for(const o of page.objects){const nombre=o.key.split('/').pop();if(regex.test(nombre))videos.push({nombre,url:`/video?evento=${encodeURIComponent(evento.id)}&clave=${encodeURIComponent(evento.clave||evento.acceso)}&nombre=${encodeURIComponent(nombre)}`,fecha:o.uploaded?.toISOString()||''});}
   cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 videos.sort((a,b)=>a.fecha.localeCompare(b.fecha));
 return Response.json({videos,maxVideos:evento.maxVideos??10},{headers:{'Cache-Control':'no-store'}});
}
export async function onRequestPost({request,env}) {
 const evento=await buscarEvento(request,env);if(!evento)return error('Álbum no disponible',404);
 const bucket=env.ALBUM_FOTOS;if(!bucket)return error('R2 no conectado',503);
 if(Date.now()>=Date.parse(evento.cierreCarga))return error('La recepción de archivos ha finalizado',403);
 const tipo=(request.headers.get('content-type')||'').split(';')[0].toLowerCase();
 const ext=tipo==='video/mp4'?'mp4':tipo==='video/quicktime'?'mov':tipo==='video/webm'?'webm':null;
 if(!ext)return error('Formato no compatible. Subí un video MP4 o MOV (iPhone)',415);
 const max=90*1024*1024;const len=Number(request.headers.get('content-length'));
 if(len>max)return error('El video supera los 90 MB permitidos',413);
 let total=0,cursor;
 do{const page=await bucket.list({prefix:`eventos/${evento.id}/videos/`,cursor});total+=page.objects.filter(o=>regex.test(o.key.split('/').pop())).length;cursor=page.truncated?page.cursor:undefined;}while(cursor);
 if(total>=(evento.maxVideos??10))return error('Se alcanzó el límite de videos de este álbum',409);
 const archivo=await request.arrayBuffer();if(!archivo.byteLength||archivo.byteLength>max)return error('El video debe pesar hasta 90 MB',413);
 const b=new Uint8Array(archivo.slice(0,16));
 const firmaCaja=String.fromCharCode(...b.slice(4,8));
 if((tipo==='video/mp4'||tipo==='video/quicktime')&&!['ftyp','moov','mdat','wide','free'].includes(firmaCaja))return error('Archivo de video MP4/MOV inválido',415);
 if(tipo==='video/webm'&&!(b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3))return error('WebM inválido',415);
 // Leer duración desde la caja mvhd del contenedor MP4/MOV.
 function duracionMP4(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const txt=(i,n)=>String.fromCharCode(...bytes.subarray(i,i+n));
  function buscar(inicio,fin,objetivo){
   let pos=inicio;
   while(pos+8<=fin){
    let tam=view.getUint32(pos),cab=8;
    if(tam===1){if(pos+16>fin)return null;const big=view.getBigUint64(pos+8);if(big>BigInt(Number.MAX_SAFE_INTEGER))return null;tam=Number(big);cab=16;}
    else if(tam===0)tam=fin-pos;
    if(tam<cab||pos+tam>fin)return null;
    const tipoCaja=txt(pos+4,4);
    if(tipoCaja===objetivo)return [pos+cab,pos+tam];
    pos+=tam;
   }
   return null;
  }
  const moov=buscar(0,bytes.length,'moov');if(!moov)return null;
  const mvhd=buscar(moov[0],moov[1],'mvhd');if(!mvhd)return null;
  const [pos,fin]=mvhd;const version=bytes[pos];
  const offset=version===0?12:version===1?20:null;
  if(offset===null||pos+offset+8>fin)return null;
  const escala=view.getUint32(pos+offset);
  const duracion=version===0?view.getUint32(pos+offset+4):Number(view.getBigUint64(pos+offset+4));
  if(!escala||!Number.isSafeInteger(duracion))return null;
  return duracion/escala;
 }
 if(tipo==='video/mp4'||tipo==='video/quicktime'){
  const segundos=duracionMP4(new Uint8Array(archivo));
  if(segundos!==null&&(!Number.isFinite(segundos)||segundos<=0||segundos>30.5))return error('El video debe durar como máximo 30 segundos',422);
 }
 const nombre=`${crypto.randomUUID()}.${ext}`;
 await bucket.put(`eventos/${evento.id}/videos/${nombre}`,archivo,{httpMetadata:{contentType:tipo==='video/quicktime'?'video/mp4':tipo}});
 return Response.json({ok:true,nombre},{status:201});
}

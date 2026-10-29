const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export default async function handler(req,res){
  const h=await (await fetch("https://www.tiktok.com/@dwenyxrbx?lang=fr",{headers:{"User-Agent":UA,"Accept-Language":"fr-FR,fr;q=0.9"}})).text();
  const ids=[...new Set([...h.matchAll(/\/video\/(\d{15,20})/g)].map(m=>m[1]))];
  const ids2=[...new Set([...h.matchAll(/"id":"(\d{18,20})"/g)].map(m=>m[1]))];
  const out={len:h.length,ids:ids.length,ids2:ids2.length,play:(h.match(/"playCount":\d+/g)||[]).length,keys:Object.keys((()=>{try{return JSON.parse(h.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)[1]).__DEFAULT_SCOPE__}catch(e){return {}}})())};
  const vid=ids[0]||ids2[0];
  if(vid){const v=await (await fetch(`https://www.tiktok.com/@dwenyxrbx/video/${vid}`,{headers:{"User-Agent":UA}})).text();out.vid=vid;out.vlen=v.length;out.vplay=(v.match(/"playCount":(\d+)/)||[])[1]||null}
  // test endpoint de liste publique
  for(const u of ["https://www.tiktok.com/api/post/item_list/?aid=1988&count=30&cursor=0&secUid="]){out.api="skip"}
  res.setHeader("Cache-Control","no-store");res.status(200).json(out);
}

const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const get=u=>fetch(u,{headers:{"User-Agent":UA,"Accept-Language":"en-US,en;q=0.9",Cookie:"CONSENT=YES+1; SOCS=CAI"}});
export default async function handler(req,res){
  const out={};
  const h=await (await get("https://www.youtube.com/playlist?list=UUtcOZH2ImIsNCCnCWKdRNoQ")).text();
  const ids=[...new Set([...h.matchAll(/"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g)].map(m=>m[1]))];
  out.len=h.length;out.ids=ids.length;out.count=(h.match(/"numVideosText":\{"runs":\[\{"text":"([^"]+)"/)||h.match(/(\d+) videos/)||[])[1]||null;
  out.cont=/continuationCommand/.test(h);out.sample=ids.slice(0,3);
  try{const r=await fetch("https://returnyoutubedislikeapi.com/votes?videoId="+ids[0]);out.ryd={status:r.status,body:(await r.text()).slice(0,200)}}catch(e){out.ryd=String(e)}
  res.setHeader("Cache-Control","no-store");res.status(200).json(out);
}

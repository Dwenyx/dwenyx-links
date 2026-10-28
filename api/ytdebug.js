const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const get=u=>fetch(u,{headers:{"User-Agent":UA,"Accept-Language":"en-US,en;q=0.9",Cookie:"CONSENT=YES+1; SOCS=CAI"}}).then(r=>r.text());
export default async function handler(req,res){
  const out={};
  for(const tab of ["videos","shorts","about"]){
    const h=await get(`https://www.youtube.com/@Dwenyxrbx/${tab}`);
    out[tab]={len:h.length,ids:[...new Set([...h.matchAll(/"videoId":"([\w-]{11})"/g)].map(m=>m[1]))].length,
      cont:/continuationCommand/.test(h),
      views:(h.match(/"viewCountText":"([^"]+)"/)||h.match(/([\d,\.\s]+) views/)||[])[1]||null,
      subs:(h.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/)||h.match(/([\d\.,]+K?) subscribers/)||[])[1]||null};
    if(tab==="shorts")out.sid=(h.match(/"videoId":"([\w-]{11})"/)||[])[1];
    if(tab==="videos")out.vid=(h.match(/"videoId":"([\w-]{11})"/)||[])[1];
  }
  for(const k of ["vid","sid"]){ if(!out[k])continue;
    const h=await get(`https://www.youtube.com/watch?v=${out[k]}`);
    const i=h.indexOf("like this video along with");
    out[k+"Page"]={len:h.length,likeA:(h.match(/like this video along with ([\d,]+) other/)||[])[1]||null,
      likeCount:(h.match(/"likeCount":"?(\d+)/)||[])[1]||null,
      label:(h.match(/"accessibilityText":"([^"]*?like[^"]*?)"/i)||[])[1]||null,
      snip:i>0?h.slice(i-80,i+80):null};
  }
  res.setHeader("Cache-Control","no-store");res.status(200).json(out);
}

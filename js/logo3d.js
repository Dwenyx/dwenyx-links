/* Logo DWENYX en vraie 3D : forme extrudée avec bords arrondis et matière chromée bleue */
import * as THREE from "./three.module.min.js";
const h1=document.querySelector(".hero h1.logo-glow");
const box=document.querySelector(".logo3d");
function webgl(){try{const c=document.createElement("canvas");return !!(c.getContext("webgl2")||c.getContext("webgl"))}catch(e){return false}}
if(h1&&box&&webgl())(async()=>{
  /* relief "gonflé" : une carte de hauteur (16 bits) devient une surface 3D arrondie, devant + derrière */
  const img=await new Promise((ok,ko)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=ko;im.src="img/logo-height.png"});
  const GW=img.width,GH=img.height;
  const cc=document.createElement("canvas");cc.width=GW;cc.height=GH;const cx=cc.getContext("2d",{willReadFrequently:true});cx.drawImage(img,0,0);
  const px=cx.getImageData(0,0,GW,GH).data,HZ=30/958;
  const SD=new Float32Array(GW*GH),HT=new Float32Array(GW*GH);
  for(let k=0;k<GW*GH;k++){SD[k]=(px[k*4+2]-128)/32;HT[k]=((px[k*4]<<8)|px[k*4+1])/65535}
  const sd=(x,y)=>SD[Math.min(GH-1,Math.max(0,y))*GW+Math.min(GW-1,Math.max(0,x))];
  /* sommets : ceux dedans gardent leur hauteur ; ceux juste dehors sont posés pile sur le contour (bord lisse) */
  const idx=new Int32Array(GW*GH).fill(-1),pos=[];let nv=0;
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    const k=y*GW+x,v=SD[k];if(v<-1.5)continue;
    let X=x,Y=y,Z=0;
    if(v>0)Z=HT[k]*HZ*GW;
    else{let gx=(sd(x+1,y)-sd(x-1,y))/2,gy=(sd(x,y+1)-sd(x,y-1))/2;const L=Math.hypot(gx,gy)||1;X=x+gx/L*(-v);Y=y+gy/L*(-v)}
    idx[k]=nv++;pos.push((X-GW/2)/GW,-(Y-GH/2)/GW,Z/GW);
  }
  const N=nv,P=new Float32Array(N*6);
  for(let k=0;k<N;k++){P[k*3]=pos[k*3];P[k*3+1]=pos[k*3+1];P[k*3+2]=pos[k*3+2];P[(N+k)*3]=pos[k*3];P[(N+k)*3+1]=pos[k*3+1];P[(N+k)*3+2]=-pos[k*3+2]*.55}
  const I=[],ins=k=>SD[k]>0;
  for(let y=0;y<GH-1;y++)for(let x=0;x<GW-1;x++){
    const ka=y*GW+x,kb=ka+1,kc=ka+GW,kd=kc+1,a=idx[ka],b=idx[kb],c=idx[kc],d=idx[kd];
    /* on coupe le carré selon la diagonale qui suit le mieux le contour */
    const diag=Math.abs(SD[ka]-SD[kd])<Math.abs(SD[kb]-SD[kc]);
    const tri=(p,q,r,kp,kq,kr)=>{if(p>=0&&q>=0&&r>=0&&(ins(kp)||ins(kq)||ins(kr)))I.push(p,q,r,N+p,N+r,N+q)};
    if(diag){tri(a,c,d,ka,kc,kd);tri(a,d,b,ka,kd,kb)}else{tri(a,c,b,ka,kc,kb);tri(b,c,d,kb,kc,kd)}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(P,3));
  geo.setIndex(new THREE.Uint32BufferAttribute(I,1));geo.computeVertexNormals();
  const ASPX=GW/GH;

  /* décor reflété : ciel blanc, bandes bleues, sol bleu nuit, panneaux lumineux */
  const ec=document.createElement("canvas");ec.width=1024;ec.height=512;const g=ec.getContext("2d");
  const gr=g.createLinearGradient(0,0,0,512);
  [[0,"#ffffff"],[.22,"#e6f6ff"],[.4,"#9fd8ff"],[.5,"#3f9cf0"],[.58,"#1a5fc4"],[.72,"#0b2f6e"],[1,"#020d24"]].forEach(([o,k])=>gr.addColorStop(o,k));
  g.fillStyle=gr;g.fillRect(0,0,1024,512);
  const strip=(x,w,a)=>{const l=g.createLinearGradient(x-w,0,x+w,0);l.addColorStop(0,"rgba(255,255,255,0)");l.addColorStop(.5,"rgba(255,255,255,"+a+")");l.addColorStop(1,"rgba(255,255,255,0)");g.fillStyle=l;g.fillRect(x-w,40,w*2,230)};
  strip(180,46,.95);strip(470,30,.8);strip(760,60,.9);strip(930,24,.7);
  g.fillStyle="rgba(120,220,255,.55)";g.fillRect(0,300,1024,10);
  const etex=new THREE.CanvasTexture(ec);etex.mapping=THREE.EquirectangularReflectionMapping;etex.colorSpace=THREE.SRGBColorSpace;

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
  const scene=new THREE.Scene();
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromEquirectangular(etex).texture;etex.dispose();pm.dispose();
  const mat=new THREE.MeshPhysicalMaterial({color:0xd2ebff,metalness:1,roughness:.06,clearcoat:1,clearcoatRoughness:.04,envMapIntensity:1.4,iridescence:.25,iridescenceIOR:1.3});
  const mesh=new THREE.Mesh(geo,mat);const grp=new THREE.Group();grp.add(mesh);scene.add(grp);
  const key=new THREE.DirectionalLight(0xffffff,1.4);key.position.set(-.6,1,1.2);scene.add(key);
  const rim=new THREE.DirectionalLight(0x5fd0ff,1.6);rim.position.set(.8,-.4,-.6);scene.add(rim);
  scene.add(new THREE.AmbientLight(0x6fb8ff,.35));
  const cam=new THREE.PerspectiveCamera(24,2,.01,20);
  const cv=renderer.domElement;cv.setAttribute("aria-hidden","true");box.append(cv);

  const ASP=ASPX;
  function size(){
    const r=box.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);
    renderer.setSize(w,h,false);cam.aspect=w/h;
    const f=Math.tan(cam.fov*Math.PI/360),needW=1/.84,needH=(1/ASP)/.78;
    cam.position.set(0,0,Math.max(needW/2/f/cam.aspect,needH/2/f));cam.updateProjectionMatrix();
  }
  size();addEventListener("resize",size);

  const still=matchMedia("(prefers-reduced-motion:reduce)").matches,touch=window.IS_TOUCH;
  let tx=0,ty=0,rx=0,ry=0,visible=true;const t0=performance.now();
  addEventListener("pointermove",e=>{if(e.pointerType==="touch")return;
    const r=box.getBoundingClientRect(),dx=(e.clientX-(r.left+r.width/2))/innerWidth,dy=(e.clientY-(r.top+r.height/2))/innerHeight;
    ty=Math.max(-1,Math.min(1,dx*2))*.42;tx=Math.max(-1,Math.min(1,dy*2))*.26},{passive:true});
  document.addEventListener("pointerleave",()=>{tx=ty=0});
  new IntersectionObserver(es=>{visible=es[0].isIntersecting}).observe(box);
  function frame(now){
    requestAnimationFrame(frame);
    if(!visible||document.hidden)return;
    const t=(now-t0)/1000;
    const sx=still?0:Math.sin(t*.6)*.05,sy=still?0:Math.sin(t*.45)*(touch?.22:.08);
    rx+=(tx+sx-rx)*.08;ry+=(ty+sy-ry)*.08;
    grp.rotation.set(rx,ry,0);
    renderer.render(scene,cam);
  }
  renderer.render(scene,cam);requestAnimationFrame(frame);
  h1.classList.add("is3d");window.LOGO3D=true;
})();

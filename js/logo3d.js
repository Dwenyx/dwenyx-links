/* Logo DWENYX en vraie 3D : forme extrudée avec bords arrondis et matière chromée bleue */
import * as THREE from "./three.module.min.js";
const h1=document.querySelector(".hero h1.logo-glow");
const box=document.querySelector(".logo3d");
function webgl(){try{const c=document.createElement("canvas");return !!(c.getContext("webgl2")||c.getContext("webgl"))}catch(e){return false}}
if(h1&&box&&webgl())(async()=>{
  /* relief "gonflé" : une carte de hauteur (16 bits) devient une surface 3D arrondie, devant + derrière */
  const img=await new Promise((ok,ko)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=ko;im.src="img/logo-height.png"});
  const STEP=window.IS_TOUCH?3:2,GW=img.width,GH=img.height;
  const cc=document.createElement("canvas");cc.width=GW;cc.height=GH;const cx=cc.getContext("2d",{willReadFrequently:true});cx.drawImage(img,0,0);
  const px=cx.getImageData(0,0,GW,GH).data;
  const W=Math.floor((GW-1)/STEP)+1,H=Math.floor((GH-1)/STEP)+1,HZ=34/GW;
  const idx=new Int32Array(W*H).fill(-1),pos=[];let nv=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const o=((y*STEP)*GW+x*STEP)*4;if(px[o+2]<128)continue;
    const h=((px[o]<<8)|px[o+1])/65535;idx[y*W+x]=nv++;pos.push((x*STEP-GW/2)/GW,-(y*STEP-GH/2)/GW,h*HZ)}
  const N=nv,P=new Float32Array(N*6);
  for(let k=0;k<N;k++){P[k*3]=pos[k*3];P[k*3+1]=pos[k*3+1];P[k*3+2]=pos[k*3+2];P[(N+k)*3]=pos[k*3];P[(N+k)*3+1]=pos[k*3+1];P[(N+k)*3+2]=-pos[k*3+2]*.55}
  const I=[];
  for(let y=0;y<H-1;y++)for(let x=0;x<W-1;x++){
    const a=idx[y*W+x],b=idx[y*W+x+1],c=idx[(y+1)*W+x],d=idx[(y+1)*W+x+1];
    if(a>=0&&c>=0&&b>=0){I.push(a,c,b,N+a,N+b,N+c)}
    if(b>=0&&c>=0&&d>=0){I.push(b,c,d,N+b,N+d,N+c)}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(P,3));
  geo.setIndex(N*2>65535?new THREE.Uint32BufferAttribute(I,1):new THREE.Uint16BufferAttribute(I,1));geo.computeVertexNormals();
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

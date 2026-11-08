/* Logo DWENYX en vraie 3D : forme extrudée avec bords arrondis et matière chromée bleue */
import * as THREE from "./three.module.min.js";
const h1=document.querySelector(".hero h1.logo-glow");
const box=document.querySelector(".logo3d");
function webgl(){try{const c=document.createElement("canvas");return !!(c.getContext("webgl2")||c.getContext("webgl"))}catch(e){return false}}
if(h1&&box&&!matchMedia("(max-width:720px)").matches&&webgl())(async()=>{
  /* relief "gonflé" : une carte de hauteur (16 bits) devient une surface 3D arrondie, devant + derrière */
  const img=await new Promise((ok,ko)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=ko;im.src="img/logo-height.png"});
  const GW=img.width,GH=img.height;
  const cc=document.createElement("canvas");cc.width=GW;cc.height=GH;const cx=cc.getContext("2d",{willReadFrequently:true});cx.drawImage(img,0,0);
  const px=cx.getImageData(0,0,GW,GH).data,HZ=30/958;
  const SD=new Float32Array(GW*GH),HT=new Float32Array(GW*GH);
  for(let k=0;k<GW*GH;k++){SD[k]=(px[k*4+2]-128)/32;HT[k]=((px[k*4]<<8)|px[k*4+1])/65535}
  const sd=(x,y)=>SD[Math.min(GH-1,Math.max(0,y))*GW+Math.min(GW-1,Math.max(0,x))];
  /* sommets : ceux dedans gardent leur hauteur ; ceux juste dehors sont posés pile sur le contour (bord lisse) */
  const idx=new Int32Array(GW*GH).fill(-1);let pos=new Float32Array(GW*GH*3),nv=0;
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
    const k=y*GW+x,v=SD[k];if(v<-1.5)continue;
    let X=x,Y=y,Z=0;
    if(v>0)Z=HT[k]*HZ*GW;
    else{let gx=(sd(x+1,y)-sd(x-1,y))/2,gy=(sd(x,y+1)-sd(x,y-1))/2;const L=Math.hypot(gx,gy)||1;X=x+gx/L*(-v);Y=y+gy/L*(-v)}
    pos[nv*3]=(X-GW/2)/GW;pos[nv*3+1]=-(Y-GH/2)/GW;pos[nv*3+2]=Z/GW;idx[k]=nv++;
  }
  const N=nv,P=new Float32Array(N*6);
  for(let k=0;k<N;k++){P[k*3]=pos[k*3];P[k*3+1]=pos[k*3+1];P[k*3+2]=pos[k*3+2];P[(N+k)*3]=pos[k*3];P[(N+k)*3+1]=pos[k*3+1];P[(N+k)*3+2]=-pos[k*3+2]*.55}
  let I=new Uint32Array(GW*GH*12),ni=0;const ins=k=>SD[k]>0;
  for(let y=0;y<GH-1;y++)for(let x=0;x<GW-1;x++){
    const ka=y*GW+x,kb=ka+1,kc=ka+GW,kd=kc+1,a=idx[ka],b=idx[kb],c=idx[kc],d=idx[kd];
    /* on coupe le carré selon la diagonale qui suit le mieux le contour */
    const diag=Math.abs(SD[ka]-SD[kd])<Math.abs(SD[kb]-SD[kc]);
    const tri=(p,q,r,kp,kq,kr)=>{if(p>=0&&q>=0&&r>=0&&(ins(kp)||ins(kq)||ins(kr))){I[ni++]=p;I[ni++]=q;I[ni++]=r;I[ni++]=N+p;I[ni++]=N+r;I[ni++]=N+q}};
    if(diag){tri(a,c,d,ka,kc,kd);tri(a,d,b,ka,kd,kb)}else{tri(a,c,b,ka,kc,kb);tri(b,c,d,kb,kc,kd)}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(P,3));
  geo.setIndex(new THREE.BufferAttribute(I.subarray(0,ni),1));geo.computeVertexNormals();
  const ASPX=GW/GH;

  /* décor reflété : ciel blanc, bandes bleues, sol bleu nuit, panneaux lumineux */
  const ec=document.createElement("canvas");ec.width=1024;ec.height=512;const g=ec.getContext("2d");
  const gr=g.createLinearGradient(0,0,0,512);
  [[0,"#ffffff"],[.25,"#f2faff"],[.42,"#bfe6ff"],[.52,"#6cbcff"],[.62,"#2f80e0"],[.78,"#164a9e"],[1,"#0a2a5e"]].forEach(([o,k])=>gr.addColorStop(o,k));
  g.fillStyle=gr;g.fillRect(0,0,1024,512);
  const strip=(x,w,a)=>{const l=g.createLinearGradient(x-w,0,x+w,0);l.addColorStop(0,"rgba(255,255,255,0)");l.addColorStop(.5,"rgba(255,255,255,"+a+")");l.addColorStop(1,"rgba(255,255,255,0)");g.fillStyle=l;g.fillRect(x-w,40,w*2,230)};
  strip(180,46,.95);strip(470,30,.8);strip(760,60,.9);strip(930,24,.7);
  g.fillStyle="rgba(120,220,255,.55)";g.fillRect(0,300,1024,10);
  const etex=new THREE.CanvasTexture(ec);etex.mapping=THREE.EquirectangularReflectionMapping;etex.colorSpace=THREE.SRGBColorSpace;

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.6;
  const scene=new THREE.Scene();
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromEquirectangular(etex).texture;etex.dispose();pm.dispose();
  const mat=new THREE.MeshPhysicalMaterial({color:0xeaf6ff,metalness:1,roughness:.06,clearcoat:1,clearcoatRoughness:.04,envMapIntensity:1.6,iridescence:.25,iridescenceIOR:1.3});
  /* reflet chrome multicolore pastel qui balaie le logo de temps en temps */
  const sweep={value:-9};
  mat.onBeforeCompile=sh=>{
    sh.uniforms.uSweep=sweep;
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 vWP;")
      .replace("#include <project_vertex>","#include <project_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;");
    sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nvarying vec3 vWP;\nuniform float uSweep;")
      .replace("#include <opaque_fragment>",`
        float u=vWP.x+vWP.y*.55-uSweep;
        float band=smoothstep(.34,0.,abs(u));
        vec3 rb=.5+.5*cos(6.2832*(u*1.6+vec3(0.,.33,.67)));
        vec3 pastel=mix(rb,vec3(1.),.22);
        float fres=.55+.45*pow(1.-abs(dot(normalize(vNormal),vec3(0.,0.,1.))),1.5);
        float lum=dot(outgoingLight,vec3(.299,.587,.114));
        outgoingLight=mix(outgoingLight,pastel*(.55+.65*clamp(lum,0.,1.2)),band*fres);
        #include <opaque_fragment>`);
  };
  const mesh=new THREE.Mesh(geo,mat);const grp=new THREE.Group();grp.add(mesh);scene.add(grp);
  const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(-.6,1,1.2);scene.add(key);
  const rim=new THREE.DirectionalLight(0x5fd0ff,1.6);rim.position.set(.8,-.4,-.6);scene.add(rim);
  scene.add(new THREE.AmbientLight(0xbfe6ff,.6));
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
  /* le logo ne regarde la souris que quand elle passe sur lui */
  h1.addEventListener("pointermove",e=>{if(e.pointerType==="touch")return;
    const r=h1.getBoundingClientRect(),dx=(e.clientX-r.left)/r.width-.5,dy=(e.clientY-r.top)/r.height-.5;
    ty=Math.max(-1,Math.min(1,dx*2))*.42;tx=Math.max(-1,Math.min(1,dy*2))*.26});
  h1.addEventListener("pointerleave",()=>{tx=ty=0});
  new IntersectionObserver(es=>{visible=es[0].isIntersecting}).observe(box);
  let hover=false,lastR=0;h1.addEventListener("pointerenter",()=>hover=true);h1.addEventListener("pointerleave",()=>hover=false);
  function frame(now){
    requestAnimationFrame(frame);
    if(!visible||document.hidden)return;
    /* 60 i/s quand la souris est sur le logo ou pendant le reflet, sinon 30 i/s (économise la carte graphique) */
    const sweeping=((now-t0)/1000%7)<1.9,moving=Math.abs(tx-rx)+Math.abs(ty-ry)>.004;
    if(!hover&&!sweeping&&!moving&&now-lastR<32)return;lastR=now;
    const t=(now-t0)/1000;
    const sx=still?0:Math.sin(t*.6)*.05,sy=still?0:Math.sin(t*.45)*(touch?.22:.08);
    rx+=(tx+sx-rx)*.08;ry+=(ty+sy-ry)*.08;
    grp.rotation.set(rx,ry,0);
    /* un passage toutes les ~7 s, qui dure 1,8 s */
    const ph=(t%7)/1.8;sweep.value=ph<1?-1.05+ph*2.1:-9;
    renderer.render(scene,cam);
  }
  /* on prépare tout (shaders compilés + première image) derrière la boule de chargement */
  try{renderer.compile(scene,cam)}catch(e){}
  renderer.render(scene,cam);requestAnimationFrame(frame);
  h1.classList.add("is3d");window.LOGO3D=true;dispatchEvent(new Event("dw:logo3d"));
})();

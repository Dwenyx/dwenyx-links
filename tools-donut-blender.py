import bpy, bmesh, math, random, json, struct, base64, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(7)
NU=200        # segments autour de l'anneau
NSE=6.0       # exposant superellipse (carré arrondi)
def P(t):
    c,s=math.cos(t),math.sin(t);e=2.0/NSE
    return Vector((math.copysign(abs(c)**e,c),0,math.copysign(abs(s)**e,s)))
def frame(t):
    p=P(t);d=(P(t+1e-4)-P(t-1e-4)).normalized();n=Vector((d.z,0,-d.x))  # normale extérieure
    if n.dot(p)<0:n=-n
    return p,n
def tube(name,Rc,prof,disp=None,NU=96,lv=1):
    """prof : liste (d,y) d'une section fermée ; disp(t,i,d,y)->dy"""
    bm=bmesh.new();vs=[]
    for k in range(NU):
        t=2*math.pi*k/NU;p,n=frame(t);row=[]
        for i,(d,y) in enumerate(prof):
            dy=disp(t,i,d,y) if disp else 0
            q=p*Rc+n*d;row.append(bm.verts.new((q.x,q.z*-1,y+dy)))  # blender: z vers le haut
        vs.append(row)
    m=len(prof)
    for k in range(NU):
        a,b=vs[k],vs[(k+1)%NU]
        for i in range(m):
            j=(i+1)%m;bm.faces.new((a[i],b[i],b[j],a[j]))
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:])
    me=bpy.data.meshes.new(name);bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob)
    for f in me.polygons:f.use_smooth=True
    sd=ob.modifiers.new('sd','SUBSURF');sd.levels=lv;sd.render_levels=lv
    return ob
def rect(d0,d1,y0,y1,nd=4,ny=3):
    pts=[]
    for i in range(nd):pts.append((d0+(d1-d0)*i/nd,y0))      # dessous (intérieur->extérieur)
    for i in range(ny):pts.append((d1,y0+(y1-y0)*i/ny))      # flanc extérieur
    for i in range(nd):pts.append((d1-(d1-d0)*i/nd,y1))      # dessus
    for i in range(ny):pts.append((d0,y1-(y1-y0)*i/ny))      # flanc du trou
    return pts
HOLE,OUT=float(sys.argv[-3]),float(sys.argv[-2]);Rc=(HOLE+OUT)/2;W=OUT-HOLE
YB,YD,YI0,YI1=-.5,-.18,-.30,-.06
dough=tube('dough',Rc,rect(-W/2,W/2,YB,YD,3,3),NU=96,lv=1)
# glaçage : déborde dehors + couvre le bord du trou ; coulures sur le flanc extérieur
ip=rect(-W/2-.012,W/2+.032,YI0,YI1,4,3)
drips=[]
for k in range(20):
    t=random.random()*2*math.pi
    # pas de coulure devant (z+ dans le jeu = -y blender ... t autour de -pi/2 ici) pour laisser la place aux yeux
    if abs(((t-math.pi/2+math.pi)%(2*math.pi))-math.pi)<0.62: continue
    drips.append((t,.065+random.random()*.04,.1+random.random()*.09))
def disp(t,i,d,y):
    if not(d>W/2 and abs(y-YI0)<1e-6) and not(d>W/2+.02 and y<YI0+.02):return 0
    s=0
    for (c,w,L) in drips:
        dt=abs(((t-c+math.pi)%(2*math.pi))-math.pi)
        if dt<w:u=dt/w;s=max(s,L*math.sqrt(max(0,1-u**4)))
    return -s
icing=tube('icing',Rc,ip,disp,NU=176,lv=1)
dg=bpy.context.evaluated_depsgraph_get()
def bake(ob):
    e=ob.evaluated_get(dg);m=e.to_mesh();m.calc_loop_triangles()
    P=[(v.co.x,v.co.z,-v.co.y) for v in m.vertices]   # vers repère three (y haut, z vers l'avant)
    N=[(v.normal.x,v.normal.z,-v.normal.y) for v in m.vertices]
    I=[i for t in m.loop_triangles for i in t.vertices]
    return P,N,I
out={}
for ob in(dough,icing):out[ob.name]=bake(ob)
# vermicelles : posés sur le dessus du glaçage (lancer de rayon)
P,N,I=out['icing'];bvh=BVHTree.FromPolygons([Vector(p) for p in P],[I[i:i+3] for i in range(0,len(I),3)])
cols=[(1,1,1),(.31,.82,1),(1,.88,.29),(.49,.94,.35),(1,.3,.37),(.69,.48,1),(1,.6,.16)]
sp=[];spn=[];spc=[];spi=[];pts=[]
def capsule(L,r,seg=10,ring=5):
    V=[];F=[]
    rows=[]
    for j in range(ring*2+2):
        if j<=ring:a=-math.pi/2+math.pi/2*j/ring;cx=-L/2
        else:a=math.pi/2*(j-ring-1)/ring;cx=L/2
        rows.append((cx+r*math.sin(a),r*math.cos(a)))
    for (x,rr) in rows:
        for k in range(seg):
            b=2*math.pi*k/seg;V.append((x,rr*math.cos(b),rr*math.sin(b)))
    for j in range(len(rows)-1):
        for k in range(seg):
            a=j*seg+k;bq=j*seg+(k+1)%seg;c=(j+1)*seg+(k+1)%seg;d=(j+1)*seg+k;F+=[(a,c,d),(a,bq,c)]
    return V,F
tries=0
while len(pts)<22 and tries<5000:
    tries+=1;x=random.uniform(-OUT,OUT);z=random.uniform(-OUT,OUT);m=max(abs(x),abs(z))
    if m<HOLE+.08 or m>OUT-.06:continue
    if any((x-a)**2+(z-b)**2<.105**2 for a,b in pts):continue
    hit=bvh.ray_cast(Vector((x,1,z)),Vector((0,-1,0)))
    if hit[0] is None:continue
    pts.append((x,z));pos,nr=hit[0],hit[1]
    if nr.y<0:nr=-nr
    V,F=capsule(.075,.019);ang=random.random()*math.pi;col=cols[len(pts)%len(cols)]
    up=Vector((0,1,0));q=up.rotation_difference(nr)
    o=len(sp)
    for v in V:
        w=Vector((v[0]*math.cos(ang)-v[2]*math.sin(ang),v[1],v[0]*math.sin(ang)+v[2]*math.cos(ang)))
        nn=Vector((0 if abs(v[0])<.0375 else (v[0]-math.copysign(.0375,v[0])),v[1],v[2])).normalized()
        nn=Vector((nn.x*math.cos(ang)-nn.z*math.sin(ang),nn.y,nn.x*math.sin(ang)+nn.z*math.cos(ang)))
        w=q@w;nn=q@nn;w=w+pos+nr*.012
        sp.append(tuple(w));spn.append(tuple(nn));spc.append(col)
    for f in F:spi+= [i+o for i in f]
out['spr']=(sp,spn,spi,spc)
# export compact : positions/normales quantifiées en int16
def pack(P,N,I,C=None):
    b=bytearray()
    d={'n':len(P),'t':len(I)}
    b+=struct.pack('<%dh'%(len(P)*3),*[int(max(-32767,min(32767,round(c*32767)))) for p in P for c in p])
    b+=struct.pack('<%db'%(len(N)*3),*[int(max(-127,min(127,round(c*127)))) for n in N for c in n])
    if len(b)%2:b+=b'\0'
    b+=struct.pack('<%dH'%len(I),*I)
    if C:b+=bytes(int(c*255) for col in C for c in col)
    d['b']=base64.b64encode(bytes(b)).decode();return d
res={k:pack(*v) for k,v in out.items()}
json.dump(res,open(sys.argv[-1],'w'))
for k,v in out.items():print(k,len(v[0]),'verts',len(v[2])//3,'tris')

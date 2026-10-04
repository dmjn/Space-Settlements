(function(){
'use strict';
/* ================================================================== */
/*  Shared helpers                                                     */
/* ================================================================== */
const G0=9.81;
const $=id=>document.getElementById(id);
const fmt=(v,dg)=>v.toLocaleString('en-US',{minimumFractionDigits:dg||0,maximumFractionDigits:dg||0});
const ro=(k,v)=>`<div><dt>${k}</dt><dd>${v}</dd></div>`;
const omegaOf=rpm=>rpm*2*Math.PI/60;
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const HAS3D=!!(window.THREE&&THREE.OrbitControls);
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const d=a=>V(Math.sin(a),0,Math.cos(a));
const at=(a,rho,y)=>d(a).multiplyScalar(rho).add(V(0,y||0,0));

/* world = everything belonging to the loaded settlement */
let world=null;
function M(part,opts){
  const m=new THREE.MeshStandardMaterial(Object.assign({roughness:.7,metalness:.15},opts));
  m.userData.base=m.emissive.clone();
  (world.partMats[part]=world.partMats[part]||[]).push(m);
  return m;
}
function clip(m,planes){m.userData.lp=planes;m.clipIntersection=true;m.side=THREE.DoubleSide;world.clipMats.push(m);return m;}
function add(mesh,part,parent){mesh.userData.part=part;world.pickables.push(mesh);parent.add(mesh);return mesh;}
function lathe(pts,ps,pl,seg){return new THREE.LatheGeometry(pts,seg||200,ps||0,pl===undefined?Math.PI*2:pl);}
function wedge(center,half,origin){
  const o=origin||V(0,0,0),t=a=>V(Math.cos(a),0,-Math.sin(a));
  return [new THREE.Plane().setFromNormalAndCoplanarPoint(t(center-half).negate(),o),new THREE.Plane().setFromNormalAndCoplanarPoint(t(center+half),o)];
}
function canvasTex(w,h,draw,rx,ry){
  const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=4;return t;
}
function shapeFrom(outer,inner){const s=new THREE.Shape();outer.forEach((p,i)=>i?s.lineTo(p.x,p.y):s.moveTo(p.x,p.y));(inner||[]).slice().reverse().forEach(p=>s.lineTo(p.x,p.y));return s;}
const groundTex=(rx,ry)=>canvasTex(64,64,(g,w,h)=>{g.fillStyle='#71834f';g.fillRect(0,0,w,h);const r=rng(3);for(let i=0;i<220;i++){g.fillStyle=['#7e9257','#667a47','#8a9a62'][i%3];g.fillRect(r()*w,r()*h,3,2);}},rx,ry);
const rockTex=(rx,ry)=>canvasTex(128,32,(g,w,h)=>{g.fillStyle='#6d645a';g.fillRect(0,0,w,h);const r=rng(5);for(let i=0;i<500;i++){const v=80+r()*50|0;g.fillStyle=`rgb(${v+10},${v},${v-12})`;g.fillRect(r()*w,r()*h,2,2);}},rx,ry);
const glassTex=(rx,ry)=>canvasTex(64,64,(g,w,h)=>{g.fillStyle='#1b2c40';g.fillRect(0,0,w,h);g.strokeStyle='#9fc8e4';g.lineWidth=2;for(let i=0;i<=4;i++){g.beginPath();g.moveTo(i*16,0);g.lineTo(i*16,h);g.stroke();g.beginPath();g.moveTo(0,i*16);g.lineTo(w,i*16);g.stroke();}},rx,ry);
const obj3=()=>new THREE.Object3D();
function instanced(list,geo,mat,part,parent,fn){const o=obj3();const im=new THREE.InstancedMesh(geo,mat,list.length);list.forEach((b,i)=>{fn(o,b);o.updateMatrix();im.setMatrixAt(i,o.matrix);});im.instanceMatrix.needsUpdate=true;return add(im,part,parent);}
/* box b=[phi,rhoCenter,y,len,width,height] standing with "up" toward the spin axis */
const placeBox=(o,b)=>{o.position.set(Math.sin(b[0])*b[1],b[2],Math.cos(b[0])*b[1]);o.rotation.set(0,b[0],0);o.scale.set(b[3],b[4],b[5]);};
const placeBlob=(o,b)=>{o.position.set(Math.sin(b[0])*b[1],b[2],Math.cos(b[0])*b[1]);o.rotation.set(0,b[0],0);o.scale.set(b[3],b[4]||b[3],b[5]||b[3]);};

/* ================================================================== */
/*  Systems registry (names) and settlements                           */
/* ================================================================== */
const SYS={
  gravity:{name:'Spin gravity',blurb:'How rotation rate and radius set your weight'},
  transit:{name:'Axis to floor',blurb:'What a trip from the dock to the ground feels like'},
  light:{name:'Path of light',blurb:'How sunlight reaches the land'},
  life:{name:'Closed life support',blurb:'Air, food and water cycling between people and plants'},
  shield:{name:'Shield mass',blurb:'Why protection dominates the mass budget'},
  heat:{name:'Heat rejection',blurb:'How much radiator a settlement needs'},
  pair:{name:'Counter-rotation',blurb:'Why Island Three comes as a pair'}
};
const SYS_ORDER=['gravity','transit','light','life','shield','pair','heat'];

/* ------------------------------ Stanford Torus -------------------- */
const TORUS=(function(){
  const R=83,r=6.5,RF=R+0.45*r,PHI_C=Math.PI/4,NARROW_H=0.44,WIDE_H=1.13,WIN=0.7,SECT=Math.PI/3,AG=[1,3,5];
  let rotor;
  return {
  id:'torus',name:'Stanford Torus',short:'Torus',year:'1975',unit:'1 unit = 10 m',
  eyebrow:'NASA SP-413 · 1975 summer study',sub:'Earth–Moon L5 · 10,000 residents',
  rpm:1,floorR:859,hasShield:true,maxDist:900,sunDir:[1,.3,.15],
  lede:'A wheel-shaped settlement for 10,000 people, designed in the summer of 1975 by a NASA Ames and Stanford University study for the Earth–Moon L5 point. It spins once a minute to make gravity, sits inside a non-rotating shield of lunar slag, and gets its daylight from mirrors.',
  figs:[['Diameter','1.79 km'],['Tube','130 m'],['Spin','1 rpm'],['Gravity','0.95 g'],['Residents','10,000'],['Farmland','63 ha']],
  compare:{shape:'Torus (wheel)',size:'1.79 km across',spin:'1 rpm',gravity:'0.95 g',people:'10,000',light:'Fixed mirror, conical mirrors, chevron louvres',shield:'Separate non-rotating slag shell'},
  sources:[['NASA SP-413, Space Settlements: A Design Study (1977), chapters 1, 4 and 5','https://nss.org/settlement/nasa/75SummerStudy/Table_of_Contents1.html'],['Stanford torus (Wikipedia)','https://en.wikipedia.org/wiki/Stanford_torus']],
  schematic:'Ring, tube, hub, spokes and the radiator area are at true proportion. Mirror size, fabrication sphere placement and the farm layout are simplified from the study\u2019s figures.',
  order:['habitat','agriculture','windows','shield','spokes','hub','docking','mirror','secondary','industry','radiators'],
  parts:{
    habitat:{name:'Habitat ring',kind:'Rotating · pressurized',sys:'gravity',blurb:'Where 10,000 people live, inside a spinning tube',
      text:['The habitat is a pressurized aluminum tube 130 m across, bent into a ring 1.79 km in diameter. Spinning the ring once a minute presses everything against its outer wall, so the outer wall becomes the floor and the hub-facing side becomes the sky.','Residents live in terraced housing stepping up the side walls, above a long valley of parks, low buildings and a stream. A walk all the way around the valley is about 5.4 km, and the land curves upward ahead of you and behind you until it disappears into the sky.','Glass windows on aluminum ribs cover a third of the tube, on the side facing the hub. Homes receive about 200 W/m² of reflected sunlight, and the study kept the air at half of sea-level pressure with a normal amount of oxygen. Less pressure means a thinner hull, built from lunar aluminum.'],
      specs:[['Outer diameter','1,790 m'],['Ring radius (to tube center)','830 m'],['Tube diameter','130 m'],['Spin','1 rpm'],['Gravity','0.95 ± 0.05 g'],['Residents','10,000'],['Air pressure','50.8 kPa (half of Earth)'],['Pressurized volume','6.9 × 10⁷ m³'],['Windows','⅓ of the tube surface'],['Hull','≈150 kt aluminum'],['Temperature','20 ± 5 °C']]},
    agriculture:{name:'Tiered farms',kind:'Rotating · three farms',sys:'life',blurb:'Three stacked farms that feed the whole settlement',
      text:['Three farms alternate with the residential sectors around the ring. Each one is a stack of tiers: fish ponds at the top, then water cascading down to irrigate corn, sorghum, soybeans, rice, alfalfa, wheat and vegetables, with a dry, enclosed bottom level for curing harvests. The tiers triple the cropland, and the study fed all 10,000 residents on about 61 to 63 ha.','Zones can be sealed off and run hotter, wetter, brighter and richer in carbon dioxide than the living areas to force rapid growth, and the partitions stop plant and animal diseases from spreading. The three farms grow the same crops on staggered schedules for a continuous supply.'],
      specs:[['Farmland','61–63 ha'],['Farms','3, each multi-tiered'],['Per farm','≈90,000 fish, 20,000 chickens, 10,000 rabbits, 500 cattle'],['Diet','2,450 kcal per person per day'],['Light on crops','up to 1,000 W/m²']]},
    windows:{name:'Chevron windows',kind:'Fixed · part of the shield',sys:'light',blurb:'Lets daylight in while keeping radiation out',
      text:['Sunlight enters the ring through a band of windows on its hub-facing side, the side residents see as the sky. A plain opening there would leave a gap in the radiation shield.','The fix is a stack of angled mirror louvres arranged in chevrons. Light bounces off the mirrored faces and zigzags through the gaps. Cosmic-ray particles travel in straight lines, so every straight path through the stack runs into shielding mass.'],
      specs:[['Location','Hub-facing side of the ring'],['Principle','Mirror louvres in a chevron stack'],['Light path','Reflected through'],['Particle path','Blocked by louvre mass']]},
    shield:{name:'Radiation shield',kind:'Non-rotating · lunar slag',sys:'shield',blurb:'Ninety-nine percent of the settlement’s mass',
      text:['Galactic cosmic rays and solar flare particles would give unprotected residents an unacceptable dose, so the study wrapped the ring in a shell 1.7 m thick, built of large bricks of fused lunar soil and slag held together by mechanical fasteners. That is about 4.5 tonnes over every square meter.','That adds up to roughly 9.9 million tonnes, about 66 times the mass of the aluminum hull. The settlement is mostly a pile of Moon rock with a thin pressurized tube inside it.','The shield is a separate shell that does not spin. A shield turning with the habitat would press outward under its own spin weight, and the hull would need to be enormously stronger to hold it. A gap of about 1.5 m lets the habitat turn freely inside a shell that carries almost no load. If the shield served as reaction mass while the ring was spun up, it would end up turning backward at about 0.07 rpm.'],
      specs:[['Material','Fused lunar soil and slag'],['Thickness','1.7 m'],['Areal mass','4.5 t/m²'],['Total mass','≈9.9 Mt'],['Gap to hull','≈1.5 m'],['Rotation','None'],['Dose target','0.5 rem/yr (5 mSv)']]},
    spokes:{name:'Spokes',kind:'Rotating · transport cores',sys:'transit',blurb:'Elevators and utilities between hub and ring',
      text:['Six spokes, each 15 m in diameter, tie the ring to the hub. They work as crossties that stop the wheel from deforming when masses shift around the ring, and they carry its traffic: elevators, power cables and the heat-exchange pipes that run to the radiator. Several thousand commuters ride them each day to jobs in the fabrication sphere and outside the habitat.','Riding up a spoke from the ring, your weight falls steadily from about 0.95 g to almost nothing, because spin gravity is proportional to distance from the axis. The elevator car also feels a sideways push, since it is being carried between radii that move at different speeds.'],
      specs:[['Count','6'],['Diameter','15 m'],['Elevator trip','830 m, hub to torus'],['Carries','Elevators, power, heat pipes'],['Gravity range','≈0.07 g to 0.9 g']]},
    hub:{name:'Central hub',kind:'Rotating · low gravity',sys:'transit',blurb:'The near-weightless center of the wheel',
      text:['The 130 m hub sits on the rotation axis, where spin gravity nearly vanishes. Even at its outer wall a person weighs only about 7 percent of their Earth weight.','In the study the hub is the settlement\u2019s crossroads: ships dock at its north end, the fabrication sphere sits at its south end, and people transfer to the spoke elevators. The study\u2019s narrator watches workers on a lunch break playing a ball game invented by construction crews, in which near-weightlessness and the Coriolis effect make every shot longer, faster and curved.'],
      specs:[['Diameter','130 m'],['Gravity at hub wall','≈0.07 g'],['Rotation','With the station, 1 rpm'],['Connections','6 spokes, docking module']]},
    docking:{name:'Docking module',kind:'Despun · on the axis',sys:'transit',blurb:'Where ships arrive without matching the spin',
      text:['Ships arrive along the axis, where the station\u2019s motion is slowest. Anywhere else, a docking ship would have to circle with the rim at about 90 m/s. Local custom in the study names the docking area the North Pole.','The module is 15 m across and carries a de-spin system: it turns backward at exactly the station\u2019s rate, so it holds still relative to arriving ships while passengers and cargo pass through into the spinning hub. All people and equipment for the habitat enter here.'],
      specs:[['Diameter','15 m'],['Location','North end of the hub'],['Rotation','Despun, stationary']]},
    mirror:{name:'Primary mirror',kind:'Non-rotating · aimed at the Sun',sys:'light',blurb:'Redirects sunlight down the station’s axis',
      text:['A burnished disc hangs above the docking area and does not rotate. Inclined at 45 degrees to the rotation axis, it turns sunlight arriving from the side and sends it down parallel to the axis, onto the ring of secondary mirrors.','Because the mirror stays fixed while the station spins beneath it, it can be kept aimed at the Sun independently of the rotation. If control of the mirror were lost, a separate 200 MW solar power station would supply emergency power. Mirror size is drawn schematically.'],
      specs:[['Rotation','None'],['Angle','45° to the rotation axis'],['Turns light by','90°'],['Location','Above the docking area'],['Size in model','Schematic']]},
    secondary:{name:'Secondary mirrors',kind:'Rotating · conical ring',sys:'light',blurb:'Spreads the light column outward to the ring',
      text:['A ring of angled mirrors around the hub catches the column of light coming down the axis and throws it outward in every direction, toward the windows on the inside of the ring.','The ring is segmented, and each segment is aimed individually. That is how the study set the light level for each part of the torus: about 200 W/m² for homes, up to 1,000 W/m² for crops, a day and night cycle for homes and some fields, and continuous light for crops that grow faster without night. Darkness comes from turning segments away from a window, and extra light from concentrating several segments on one.'],
      specs:[['Rotation','With the station'],['Shape','Segmented conical ring'],['Light in homes','≈200 W/m²'],['Light on crops','up to 1,000 W/m²'],['Sunlight in space','1,400 W/m²']]},
    industry:{name:'Fabrication sphere and power',kind:'Fixed · south of the hub',sys:'heat',blurb:'Where metal is shaped and power is made',
      text:['A sphere 100 m across sits on the south side of the hub and does not rotate. Metals are shaped and formed there and much of the colony\u2019s assembly takes place inside it, in weightlessness. Beside it stands a 200 MW solar power plant and furnace for fabrication.','The habitat\u2019s own electricity, 50 MW, comes from silicon solar cells stretched between the spokes, hub and secondary mirrors. They face north toward the main mirror, where the other mirrors shelter them from the solar wind. The study budgeted 3 kW per person, twice the US figure of the time, because every material has to be recycled. Heavy refining happens at a separate plant about 10 km south, not shown.'],
      specs:[['Fabrication sphere','100 m, non-rotating'],['Solar power plant','200 MW, for fabrication'],['Habitat electricity','50 MW from solar cells'],['Per person','3 kW'],['Extraction plant','≈10 km south (not shown)']]},
    radiators:{name:'Habitat radiator',kind:'Fixed · edge toward the Sun',sys:'heat',blurb:'A paddle that sheds the colony\u2019s heat',
      text:['Everything that happens in the ring ends as heat. The study\u2019s energy budget counts 66 MW of sunlight on the farms (most of it carried off as water evaporated from leaves), 35 MW lighting the living areas, and 30 MW of electricity, all of which must leave again. In vacuum there is no air or water to carry it away, so the only exit is thermal radiation.','Heat exchangers carry it through the spokes to a large non-rotating paddle on the south side of the hub, held with its edge toward the Sun. At 280 K the study needed 6.3 × 10⁵ m², plus half again for daytime peaks. The paddle in this model is drawn at the 4.9 × 10⁵ m² given in the study\u2019s tour of the colony.'],
      specs:[['Heat load','≈130 MW'],['Temperature','280 K'],['Area needed','6.3 × 10⁵ m², 9.4 × 10⁵ with margin'],['Area in the tour','4.9 × 10⁵ m²'],['Mass','≈2,400 t'],['Rotation','None']]}
  },
  sys:{
    gravity:{note1:'The study held the spin to 1 rpm, a conservative limit, which is why the ring has to be so large.'},
    transit:{intro:'Weight changes all along the trip from an arriving ship to the valley floor. Scrub the slider or ride the elevator.',button:'Ride to the rim',
      segs:[{n:'Dock',len:60,r:()=>0,c:'#55667F'},{n:'Hub',len:65,r:s=>s,c:'#7E8A97'},{n:'Spoke elevator',len:700,r:s=>65+s,c:'#A9CFE6',cor:true},{n:'Ring',len:94,r:s=>765+s,c:'#93C76D'}],
      note:'The despun dock has no spin gravity at all, and even the hub wall gives only 0.07 g, which suits heavy cargo handling. The sideways push in the elevator is the Coriolis effect: the car is carried out to radii that move faster, and the spoke wall has to keep shoving it along.'},
    light:{kind:'torus'},
    life:{nodes:{air:['Air','50.8 kPa'],people:['People','10,000'],crops:['Crops','63 ha'],water:['Water &','waste'],animals:['Animals','3 farms']},
      air:[['O₂',22.7,'o2'],['N₂',26.6,'n2'],['H₂O',1.0,'water'],['CO₂',.4,'co2']],
      intro:'The ring recycles nearly everything. Plants and animals sit in the same loop as people, trading oxygen, carbon dioxide, food and water. Select a node to isolate its flows.',
      note:'Oxygen sits at about Earth’s level, 22.7 kPa, so breathing feels normal. Most of the nitrogen is left out, halving the total pressure the hull has to hold and leaving less gas to lose through leaks. Waste is broken down by wet oxidation at the bottom of each farm and returned as feed and fertilizer, and water is recovered by condensing it out of the air.'},
    shield:{area:4*Math.PI*Math.PI*830*67,design:4.5,designLabel:'Study design',hull:.15,pop:10000,
      intro:'Radiation protection is bought with mass per square meter. Change the shield’s areal mass and see what it does to the settlement.',
      note:'Earth’s atmosphere stacks about 10.3 t of air over every square meter of sea-level ground. The study settled on 4.5 t/m², enough to bring the yearly dose down to its 0.5 rem target, and accepted that the shield would be almost all of the settlement’s mass. That is why it had to come from the Moon, launched by mass driver, instead of from Earth.'},
    heat:{P:130,T:280,label:'Heat to reject (study ≈131 MW)'}
  },
  build(root){
    const NARROW=wedge(PHI_C,NARROW_H),WIDE=wedge(PHI_C,WIDE_H).concat([new THREE.Plane(V(0,-1,0),-0.06)]);
    rotor=new THREE.Group();root.add(rotor);world.rotors.push({obj:rotor,sign:1});
    const arc=(rad,t0,t1,n)=>{const p=[];n=n||28;for(let i=0;i<=n;i++){const t=t0+(t1-t0)*i/n;p.push(new THREE.Vector2(R+rad*Math.cos(t),rad*Math.sin(t)));}return p;};
    const hullOut={color:0xb4bec8,metalness:.35,roughness:.5},hullIn={color:0x3a4659,roughness:.85};
    add(new THREE.Mesh(lathe(arc(r,0,Math.PI)),clip(M('habitat',hullOut),WIDE)),'habitat',rotor);
    add(new THREE.Mesh(lathe(arc(r,Math.PI,2*Math.PI)),clip(M('habitat',hullOut),NARROW)),'habitat',rotor);
    add(new THREE.Mesh(lathe(arc(r-.3,0,Math.PI)),clip(M('habitat',hullIn),WIDE)),'habitat',rotor);
    add(new THREE.Mesh(lathe(arc(r-.3,Math.PI,2*Math.PI)),clip(M('habitat',hullIn),NARROW)),'habitat',rotor);
    const wF=Math.sqrt(r*r-(RF-R)*(RF-R));
    add(new THREE.Mesh(lathe([new THREE.Vector2(RF,-wF),new THREE.Vector2(RF,wF)]),clip(M('habitat',{color:0xffffff,map:groundTex(300,6),roughness:.95}),NARROW)),'habitat',rotor);
    add(new THREE.Mesh(lathe([new THREE.Vector2(RF-.03,-.3),new THREE.Vector2(RF-.03,.3)]),clip(M('habitat',{color:0x4f86c6,emissive:0x0d2340,roughness:.3,metalness:.2}),NARROW)),'habitat',rotor);
    const crops=canvasTex(64,16,(g,w,h)=>{for(let i=0;i<8;i++){g.fillStyle=i%2?'#5f9a3f':'#7fb552';g.fillRect(i*8,0,8,h);}},500,1);
    const agMat=clip(M('agriculture',{color:0xffffff,map:crops,roughness:.9,emissive:0x0c1a06}),NARROW),slabMat=clip(M('agriculture',{color:0x8d939c,roughness:.8}),NARROW),lm=clip(M('agriculture',{color:0xfff3c4,emissive:0x8a6a2a}),NARROW);
    AG.forEach(k=>{const ps=k*SECT+.035,pl=SECT-.07;[0,1,2].forEach(i=>{const rho=RF-.04-i*.27*r,w=Math.sqrt(r*r-(rho-R)*(rho-R))-.25;
      add(new THREE.Mesh(lathe([new THREE.Vector2(rho,-w),new THREE.Vector2(rho,w)],ps,pl,80),agMat),'agriculture',rotor);
      if(i>0){add(new THREE.Mesh(lathe([new THREE.Vector2(rho+.25,-w),new THREE.Vector2(rho+.25,w)],ps,pl,80),slabMat),'agriculture',rotor);
        add(new THREE.Mesh(lathe([new THREE.Vector2(rho+.24,-w*.9),new THREE.Vector2(rho+.24,-w*.86)],ps,pl,80),lm),'agriculture',rotor);}});});
    const rn=rng(42),bx=[],hs=[],tr=[];
    for(let k=0;k<6;k++){if(AG.indexOf(k)>=0)continue;const p0=k*SECT+.05,p1=(k+1)*SECT-.05;
      for(const s of [-1,1])for(let lv=0;lv<5;lv++){const rho=RF-lv*.16*r,D=(.30-.045*lv)*r;let phi=p0+rn()*.01;
        while(phi<p1){const L=1.1+rn()*1.1,h=.16*r*(.85+rn()*.3),top=rho-h,yw=Math.min(Math.sqrt(r*r-(rho-R)*(rho-R)),Math.sqrt(Math.max(0,r*r-(top-R)*(top-R))))-.12,dd=D*(.8+rn()*.25);
          bx.push([phi+L/2/rho,rho-h/2,s*(yw-dd/2),L,dd,h]);phi+=(L+.25+rn()*.4)/rho;}}
      for(let i=0;i<220;i++){const phi=p0+rn()*(p1-p0),y=(rn()<.5?-1:1)*(.08+rn()*.42)*r,h=.25+rn()*.6,sz=.5+rn()*.7;hs.push([phi,RF-h/2,y,sz,sz*(.8+rn()*.6),h]);}
      for(let i=0;i<520;i++){const phi=p0+rn()*(p1-p0),y=(rn()<.5?-1:1)*(.06+rn()*.5)*r,sz=.3+rn()*.35;tr.push([phi,RF-sz*.9,y,sz]);}}
    const box=new THREE.BoxGeometry(1,1,1);
    instanced(bx,box,clip(M('habitat',{color:0xd9dccf,roughness:.8}),NARROW),'habitat',rotor,placeBox);
    instanced(hs,box,clip(M('habitat',{color:0xc9bfae,roughness:.85}),NARROW),'habitat',rotor,placeBox);
    instanced(tr,new THREE.IcosahedronGeometry(1,0),clip(M('habitat',{color:0x4c7a3c,roughness:.9,flatShading:true}),NARROW),'habitat',rotor,placeBlob);
    const spokeMat=M('spokes',{color:0xa8b2bc,metalness:.4,roughness:.45}),spokeLen=(R-r)-6.5;
    for(let k=0;k<6;k++){const dir=d(k*SECT),q=new THREE.Quaternion().setFromUnitVectors(V(0,1,0),dir);
      const m=new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,spokeLen,20),spokeMat);m.quaternion.copy(q);m.position.copy(dir.clone().multiplyScalar(6.5+spokeLen/2));add(m,'spokes',rotor);
      for(const f of [.25,.5,.75]){const c=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.05,.5,20),spokeMat);c.quaternion.copy(q);c.position.copy(dir.clone().multiplyScalar(6.5+spokeLen*f));add(c,'spokes',rotor);}}
    add(new THREE.Mesh(new THREE.SphereGeometry(6.5,48,32),M('hub',{color:0xb9c3cc,metalness:.35,roughness:.45})),'hub',rotor);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(6.55,.45,12,72),M('hub',{color:0x7e8a97,metalness:.5,roughness:.4}));collar.rotation.x=Math.PI/2;add(collar,'hub',rotor);
    add(new THREE.Mesh(new THREE.CylinderGeometry(17,9,8,96,1,true),M('secondary',{color:0xdde7ef,metalness:.85,roughness:.18,emissive:0x1a2430,side:THREE.DoubleSide})),'secondary',rotor).position.y=3;
    const shOut={color:0xffffff,map:rockTex(240,4),roughness:1},shIn={color:0x4a443d,roughness:1};
    [[r+.55,shOut],[r+.38,shIn]].forEach(([rad,o])=>{
      world.shieldMeshes.push(add(new THREE.Mesh(lathe(arc(rad,0,Math.PI-WIN)),clip(M('shield',o),WIDE)),'shield',root));
      world.shieldMeshes.push(add(new THREE.Mesh(lathe(arc(rad,Math.PI+WIN,2*Math.PI)),clip(M('shield',o),NARROW)),'shield',root));});
    const chev=canvasTex(64,64,(g,w,h)=>{g.fillStyle='#18283a';g.fillRect(0,0,w,h);g.strokeStyle='#bfe2f5';g.lineWidth=5;for(let i=-1;i<3;i++){g.beginPath();g.moveTo(0,i*32+8);g.lineTo(32,i*32+24);g.lineTo(64,i*32+8);g.stroke();}},420,3);
    const chevM={color:0xffffff,map:chev,emissive:0x36597a,emissiveMap:chev,roughness:.3,metalness:.4};
    add(new THREE.Mesh(lathe(arc(r+.46,Math.PI-WIN,Math.PI,10)),clip(M('windows',chevM),WIDE)),'windows',root);
    add(new THREE.Mesh(lathe(arc(r+.46,Math.PI,Math.PI+WIN,10)),clip(M('windows',chevM),NARROW)),'windows',root);
    const thF=Math.acos((RF-R)/(r-.3));
    const caps=[[new THREE.ShapeGeometry(shapeFrom(arc(r,Math.PI,2*Math.PI,40),arc(r-.3,Math.PI,2*Math.PI,40))),M('habitat',{color:0xe8edf1,side:THREE.DoubleSide,roughness:.6}),'habitat',false],
      [new THREE.ShapeGeometry(shapeFrom(arc(r-.3,-thF,thF,40))),M('habitat',{color:0x5b4a39,side:THREE.DoubleSide,roughness:1}),'habitat',false],
      [new THREE.ShapeGeometry(shapeFrom(arc(r+.55,Math.PI+WIN,2*Math.PI,40),arc(r+.38,Math.PI+WIN,2*Math.PI,40))),M('shield',{color:0xb3a184,side:THREE.DoubleSide,roughness:1}),'shield',true],
      [new THREE.ShapeGeometry(shapeFrom(arc(r+.5,Math.PI,Math.PI+WIN,20),arc(r+.42,Math.PI,Math.PI+WIN,20))),M('windows',{color:0xbfe2f5,emissive:0x36597a,side:THREE.DoubleSide}),'windows',false]];
    [PHI_C-NARROW_H,PHI_C+NARROW_H].forEach(a=>caps.forEach(([g,m,part,isSh])=>{const c=new THREE.Mesh(g,m);c.rotation.y=a-Math.PI/2;add(c,part,root);world.capMeshes.push(c);if(isSh)world.shieldMeshes.push(c);}));
    const dockMat=M('docking',{color:0xc4ccd4,metalness:.4,roughness:.45});
    add(new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,6,24),dockMat),'docking',root).position.y=9.5;
    add(new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,.7,40),M('docking',{color:0x7e8a97,metalness:.5,roughness:.4})),'docking',root).position.y=7;
    const ship=new THREE.Mesh(new THREE.ConeGeometry(.9,3.2,16),M('docking',{color:0xe9e2d0,roughness:.6}));ship.position.set(0,14.1,0);add(ship,'docking',root);
    const n=V(1,-1,0).normalize(),mc=V(0,55,0),rimMat=M('mirror',{color:0x8f9aa6,metalness:.5,roughness:.4});
    const mir=new THREE.Mesh(new THREE.CircleGeometry(24,96),M('mirror',{color:0xd6e3ee,metalness:.9,roughness:.12,emissive:0x1b2633,side:THREE.DoubleSide}));mir.position.copy(mc);mir.lookAt(mc.clone().add(n));add(mir,'mirror',root);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(24,.35,8,96),rimMat);rim.position.copy(mc);rim.lookAt(mc.clone().add(n));add(rim,'mirror',root);
    const fab=M('industry',{color:0xc2cad2,metalness:.35,roughness:.45});
    add(new THREE.Mesh(new THREE.SphereGeometry(5,32,24),fab),'industry',root).position.y=-14;
    add(new THREE.Mesh(new THREE.CylinderGeometry(1,1,4,16),fab),'industry',root).position.y=-8;
    {const pp=new THREE.Mesh(new THREE.BoxGeometry(.3,14,22),M('industry',{color:0x22344e,metalness:.5,roughness:.35,emissive:0x0a1626}));pp.position.set(0,-14,17);add(pp,'industry',root);
     const s=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,6,8),fab);s.rotation.x=Math.PI/2;s.position.set(0,-14,7.5);add(s,'industry',root);}
    {const cells=new THREE.Mesh(new THREE.RingGeometry(18,34,96),M('industry',{color:0x1d2f4a,metalness:.5,roughness:.35,emissive:0x0a1626,side:THREE.DoubleSide}));cells.rotation.x=-Math.PI/2;cells.position.y=-.6;add(cells,'industry',rotor);}
    const radMat=M('radiators',{color:0x56606b,roughness:.6,metalness:.4});
    add(new THREE.Mesh(new THREE.BoxGeometry(50,.3,98),radMat),'radiators',root).position.set(0,-14,-57);
    {const p=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,6,8),radMat);p.rotation.x=Math.PI/2;p.position.set(0,-14,-7.5);add(p,'radiators',root);}
    const lg=new THREE.Group();root.add(lg);world.lightGroup=lg;world.lightParts=['mirror','secondary','windows'];
    const bm=new THREE.MeshBasicMaterial({color:0xffd98a,transparent:true,opacity:.08,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
    const sb=new THREE.Mesh(new THREE.CylinderGeometry(17,17,260,64,1,true),bm);sb.rotation.z=Math.PI/2;sb.position.set(147,55,0);lg.add(sb);
    [17,9].forEach(rr=>{const c=new THREE.Mesh(new THREE.CylinderGeometry(rr,rr,52,64,1,true),bm);c.position.y=29;lg.add(c);});
    const sheet=new THREE.Mesh(new THREE.RingGeometry(17,R-r-.6,160),bm);sheet.rotation.x=-Math.PI/2;sheet.position.y=3;lg.add(sheet);
    world.sunPos=V(2600,55,0);
    world.views={
      overview:{cam:at(PHI_C,235,150),tgt:V(0,6,0)},
      habitat:{cam:at(PHI_C+.02,R+3,15),tgt:at(PHI_C+.44,R+1,-1)},agriculture:{cam:at(PHI_C+.02,R+3,15),tgt:at(PHI_C+.44,R+1,-1)},
      windows:{cam:at(PHI_C-1.0,R-46,15),tgt:at(PHI_C-1.33,R-r,0)},shield:{cam:at(PHI_C+.22,R+16,5),tgt:at(PHI_C+.44,R+3,0)},
      spokes:{cam:at(PHI_C-.45,150,75),tgt:at(PHI_C,35,0)},hub:{cam:at(PHI_C,40,22),tgt:V(0,1,0)},docking:{cam:at(PHI_C,24,26),tgt:V(0,9.5,0)},
      mirror:{cam:at(PHI_C+.6,175,120),tgt:V(0,30,0)},secondary:{cam:at(PHI_C,58,24),tgt:V(0,3,0)},industry:{cam:at(PHI_C+.5,52,-26),tgt:V(0,-12,6)},radiators:{cam:V(150,-90,40),tgt:V(0,-14,-50)}};
    world.anchors={habitat:at(PHI_C+.8,RF-.6,-1.5),agriculture:[rotor,at(Math.PI/2,RF-.27*r,0)],windows:at(PHI_C-1.45,R-r-.5,0),shield:at(PHI_C+1.6,R+r+.55,-2),
      spokes:[rotor,at(0,42,0)],hub:at(PHI_C,6.6,2),docking:at(PHI_C,.8,10.5),mirror:V(0,55,14),secondary:at(PHI_C,13.5,4),industry:at(PHI_C,5,-14),radiators:V(20,-14,-80)};
  },
  onSelect(id,api){
    if(id==='agriculture')api.alignRotor(rotor,AG.map(k=>(k+.5)*SECT),PHI_C+NARROW_H+.5);
    if(id==='habitat')api.alignRotor(rotor,[0,2,4].map(k=>(k+.5)*SECT),PHI_C+NARROW_H+.5);
  }
};})();

/* ------------------------------ Bernal sphere (Island One) -------- */
/* Shared sphere builder (Island One and Island Two). Sphere radius is 50 units; the unit length differs per settlement. */
const buildSphere=(function(){const Rs=50,PHI_C=Math.PI/4,H=0.8,LAND=0.6,W0=0.95,W1=1.33;
  const sph=(rad,t0,t1,n)=>{const p=[];n=n||48;for(let i=0;i<=n;i++){const t=t0+(t1-t0)*i/n;p.push(new THREE.Vector2(rad*Math.cos(t),rad*Math.sin(t)));}return p;};
  return function(root,o){
    const NARROW=wedge(PHI_C,H);
    const rot=new THREE.Group();root.add(rot);world.rotors.push({obj:rot,sign:1});
    const hullOut={color:0xb4bec8,metalness:.35,roughness:.5},hullIn={color:0x3a4659,roughness:.85};
    // hull outside the window bands, then window bands
    [[-Math.PI/2,-W1],[-W0,W0],[W1,Math.PI/2]].forEach(([a,b])=>{
      add(new THREE.Mesh(lathe(sph(Rs,a,b,24),0,Math.PI*2,160),clip(M('shell',hullOut),NARROW)),'shell',rot);
      add(new THREE.Mesh(lathe(sph(Rs-.6,a,b,24),0,Math.PI*2,160),clip(M('shell',hullIn),NARROW)),'shell',rot);});
    const gl={color:0xffffff,map:glassTex(90,4),emissive:0x2c4d6b,emissiveMap:glassTex(90,4),roughness:.25,metalness:.3};
    [[-W1,-W0],[W0,W1]].forEach(([a,b])=>add(new THREE.Mesh(lathe(sph(Rs-.1,a,b,10),0,Math.PI*2,160),clip(M('windows',gl),NARROW)),'windows',rot));
    // land band
    add(new THREE.Mesh(lathe(sph(Rs-.7,-LAND,LAND,30),0,Math.PI*2,160),clip(M('valley',{color:0xffffff,map:groundTex(90,10),roughness:.95}),NARROW)),'valley',rot);
    add(new THREE.Mesh(lathe(sph(Rs-.78,-o.lake,o.lake,4),0,Math.PI*2,160),clip(M('valley',{color:0x4f86c6,emissive:0x0d2340,roughness:.3}),NARROW)),'valley',rot);
    const rn=rng(11),hs=[],tr=[],Ri=Rs-.7;
    for(let i=0;i<o.houses;i++){const lat=(rn()<.5?-1:1)*(.07+rn()*.48),y=Ri*Math.sin(lat),rhoS=Math.sqrt(Ri*Ri-y*y),h=(.8+rn()*1.6*(1-Math.abs(lat)))*o.hs,sz=(1+rn()*1.4)*o.hs;if(Math.abs(lat)<o.lake+.02)continue;hs.push([rn()*Math.PI*2,rhoS-h/2+.2,y,sz,sz*(.7+rn()*.5),h]);}
    for(let i=0;i<o.trees;i++){const lat=(rn()<.5?-1:1)*(.05+rn()*.53),y=Ri*Math.sin(lat),rhoS=Math.sqrt(Ri*Ri-y*y),sz=(.5+rn()*.5)*o.ts;if(Math.abs(lat)<o.lake+.02)continue;tr.push([rn()*Math.PI*2,rhoS-sz*.8,y,sz]);}
    const box=new THREE.BoxGeometry(1,1,1);
    instanced(hs,box,clip(M('valley',{color:0xdcd7c8,roughness:.8}),NARROW),'valley',rot,placeBox);
    instanced(tr,new THREE.IcosahedronGeometry(1,0),clip(M('valley',{color:0x4c7a3c,roughness:.9,flatShading:true}),NARROW),'valley',rot,placeBlob);
    // shield (non-rotating), leaves window bands open
    const shO={color:0xffffff,map:rockTex(60,8),roughness:1},shI={color:0x4a443d,roughness:1};
    [[Rs+1.8,shO],[Rs+.8,shI]].forEach(([rad,o])=>{world.shieldMeshes.push(add(new THREE.Mesh(lathe(sph(rad,-W0+.02,W0-.02,30),0,Math.PI*2,160),clip(M('shell',o),NARROW)),'shell',root));});
    // section caps
    const caps=[[shapeFrom(sph(Rs,-Math.PI/2,Math.PI/2,60),sph(Rs-.6,-Math.PI/2,Math.PI/2,60)),{color:0xe8edf1},false,'shell'],
      [shapeFrom(sph(Rs+1.8,-W0+.02,W0-.02,40),sph(Rs+.8,-W0+.02,W0-.02,40)),{color:0xb3a184},true,'shell'],
      [shapeFrom(sph(Rs-.6,-LAND,LAND,30),sph(Rs-1.4,-LAND,LAND,30)),{color:0x5b4a39},false,'valley']];
    [PHI_C-H,PHI_C+H].forEach(a=>caps.forEach(([sh,o,isSh,part])=>{const c=new THREE.Mesh(new THREE.ShapeGeometry(sh),M(part,Object.assign({side:THREE.DoubleSide,roughness:.9},o)));c.rotation.y=a-Math.PI/2;add(c,part,root);world.capMeshes.push(c);if(isSh)world.shieldMeshes.push(c);}));
    // spindles and crystal palace rings (rotate)
    const sp=M('palace',{color:0x9aa4ae,metalness:.4,roughness:.45});
    [1,-1].forEach(s=>{const c=new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,28,20),sp);c.position.y=s*(Rs+13);add(c,'palace',rot);
      [9,15,21].forEach(o=>{const t=new THREE.Mesh(new THREE.TorusGeometry(15,2.6,16,80),M('palace',{color:0x8fc27a,roughness:.35,metalness:.2,emissive:0x16290f}));t.rotation.x=Math.PI/2;t.position.y=s*(Rs+o);add(t,'palace',rot);
        for(let k=0;k<4;k++){const b=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,13,6),sp);b.rotation.z=Math.PI/2;b.rotation.y=k*Math.PI/4;b.position.y=s*(Rs+o);rot.add(b);}});});
    // ring mirrors (fixed)
    const mm={color:0xd6e3ee,metalness:.9,roughness:.12,emissive:0x1b2633,side:THREE.DoubleSide};
    [1,-1].forEach(s=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(s>0?42:27,s>0?27:42,9,96,1,true),M('mirrors',mm));m.position.y=s*(Rs+3);add(m,'mirrors',root);
});
    // docking (top) and radiators (bottom), fixed
    add(new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.2,7,24),M('docking',{color:0xc4ccd4,metalness:.4,roughness:.45})),'docking',root).position.y=Rs+30.5;
    add(new THREE.Mesh(new THREE.CylinderGeometry(4,4,.8,40),M('docking',{color:0x7e8a97,metalness:.5})),'docking',root).position.y=Rs+27.5;
    const ship=new THREE.Mesh(new THREE.ConeGeometry(1.6,5,16),M('docking',{color:0xe9e2d0}));ship.position.y=Rs+36.5;add(ship,'docking',root);
    const radMat=M('radiators',{color:0x8e98a3,roughness:.5,metalness:.45,emissive:0x2a1208});
    for(let k=0;k<4;k++){const a=k*Math.PI/2+Math.PI/4,f=new THREE.Mesh(new THREE.BoxGeometry(.2,16,9),radMat);f.position.copy(d(a).multiplyScalar(6.4)).setY(-(Rs+34));f.rotation.y=a;add(f,'radiators',root);}
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,18,12),radMat),'radiators',root).position.y=-(Rs+34);
    if(o.industry){const im=M('industry',{color:0xb9c3cc,metalness:.4,roughness:.45}),pm=M('industry',{color:0x22344e,metalness:.5,roughness:.35,emissive:0x0a1626});
      add(new THREE.Mesh(new THREE.CylinderGeometry(.9,.9,26,10),im),'industry',root).position.y=-(Rs+52);
      [[0,-(Rs+60),0,5],[7,-(Rs+64),3,3.2],[-6,-(Rs+66),-4,3.6],[2,-(Rs+70),-7,2.6]].forEach(([x,y,z,r])=>{add(new THREE.Mesh(new THREE.SphereGeometry(r,24,16),im),'industry',root).position.set(x,y,z);});
      const pp=new THREE.Mesh(new THREE.BoxGeometry(.3,12,26),pm);pp.position.set(0,-(Rs+64),16);add(pp,'industry',root);}
    world.sunPos=V(300,2600,500);
    const lat=(a,la,rad)=>d(a).multiplyScalar(rad*Math.cos(la)).setY(rad*Math.sin(la));
    world.views={overview:{cam:at(PHI_C,250,120),tgt:V(0,4,0)},
      valley:{cam:at(PHI_C,Rs+48,24),tgt:at(PHI_C+Math.PI,Rs*.75,-4)},shell:{cam:at(PHI_C+.3,Rs+22,8),tgt:at(PHI_C+H,Rs-4,0)},
      windows:{cam:at(PHI_C,80,85),tgt:V(0,Rs*.8,0)},mirrors:{cam:at(PHI_C,120,110),tgt:V(0,Rs+4,0)},palace:{cam:at(PHI_C+.4,85,95),tgt:V(0,Rs+15,0)},
      docking:{cam:at(PHI_C,26,Rs+48),tgt:V(0,Rs+31,0)},radiators:{cam:at(PHI_C,46,-(Rs+46)),tgt:V(0,-(Rs+34),0)},industry:{cam:at(PHI_C,60,-(Rs+70)),tgt:V(0,-(Rs+63),0)}};
    world.anchors={valley:lat(PHI_C+2.7,-.15,Rs-1.4),shell:lat(PHI_C+1.9,-.45,Rs+1.8),windows:lat(PHI_C-1.2,1.1,Rs),mirrors:at(PHI_C-.6,40,Rs+6),
      palace:at(PHI_C+.5,15,-(Rs+15)),docking:at(PHI_C,2.2,Rs+31),radiators:at(PHI_C,6.4,-(Rs+38)),industry:V(0,-(Rs+60),5)};
  };})();

const BERNAL=(function(){
  const Rs=50,PHI_C=Math.PI/4,H=0.8,LAND=0.6,W0=0.95,W1=1.33; // 1 unit = 5 m; sphere radius 250 m
  const sph=(rad,t0,t1,n)=>{const p=[];n=n||48;for(let i=0;i<=n;i++){const t=t0+(t1-t0)*i/n;p.push(new THREE.Vector2(rad*Math.cos(t),rad*Math.sin(t)));}return p;};
  return {
  id:'bernal',name:'Bernal Sphere',short:'Island One',year:'1976',unit:'1 unit = 5 m',
  eyebrow:'Island One · The High Frontier',sub:'High orbit or L5 · 10,000 residents',
  rpm:1.9,floorR:250,hasShield:true,maxDist:700,sunDir:[.15,1,.25],
  lede:'Island One is Gerard O’Neill’s design for a first community of 10,000 people, set out in The High Frontier (1976). The living area is the inside of a sphere one mile around, about 500 m across, turning about twice a minute for full gravity at its equator. Farms sit outside in a stack of glazed rings, and stationary mirrors bring sunlight in through windows near the poles. The spherical form goes back to J. D. Bernal’s 1929 essay The World, the Flesh and the Devil.',
  figs:[['Circumference','1.6 km'],['Diameter','≈500 m'],['Spin','≈1.9 rpm'],['Gravity','1 g at equator'],['Residents','10,000'],['Farmland','≈64 ha']],
  compare:{shape:'Sphere with farm rings',size:'≈500 m across',spin:'≈1.9 rpm',gravity:'1 g at equator, 0 at poles',people:'10,000',light:'Stationary mirrors into polar windows',shield:'Non-rotating shell of lunar soil, ≈3 Mt'},
  sources:[['Gerard K. O’Neill, The High Frontier (1976), chapters on Island One','https://en.wikipedia.org/wiki/The_High_Frontier:_Human_Colonies_in_Space'],['Bernal sphere (Wikipedia)','https://en.wikipedia.org/wiki/Bernal_sphere']],
  schematic:'Sphere at true proportion. Shield thickness is exaggerated; mirror rings, farm ring size, docking and radiators are schematic.',
  order:['valley','shell','windows','mirrors','palace','docking','radiators'],
  parts:{
    valley:{name:'Equatorial valley',kind:'Rotating · inner surface',sys:'gravity',blurb:'Terraced homes and a river around the sphere’s waist',
      text:['Residents live on the inside of the sphere, where gravity is a full 1 g at the equator and fades toward the poles. At 45° latitude, halfway to the pole, it is about a third lighter. O’Neill used that latitude as a self-imposed design limit for homes until people gained experience with low gravity.','Apartments step up the slope in terraces. Each family of five gets about 230 m² of floor area with a private sunlit garden a quarter that size, and the rest of the surface goes to parks, shops, groves and streams. A shallow river winds around the equator with deep pools for swimming and beaches of lunar sand. Walking from the equator to the low-gravity pools and human-powered flight hangars near the axis feels like climbing a gentle hill and takes about twenty minutes.','The sphere can be divided into three villages that keep time zones eight hours apart, so industry runs around the clock while everyone works a day shift. Sunlight always enters at the same angle, set to feel like late morning.'],
      specs:[['Circumference','1 mile (1.6 km)'],['Spin','≈1.9 rpm, about twice a minute'],['Gravity at equator','≈1 g'],['Gravity at 45° latitude','≈⅔ g'],['Residents','10,000'],['Apartment, family of five','≈230 m² plus garden'],['Walk to the axis','≈20 minutes']]},
    shell:{name:'Hull and shield',kind:'Pressure shell · lunar shielding',sys:'shield',blurb:'The least surface for the most volume',
      text:['For a given volume a sphere has the least surface area, which keeps both the hull and the radiation shield as light as possible. Island One’s aluminum wall is still as thick as battleship armor, up to seven inches (18 cm) at the equator, and its structural mass is about 100,000 tonnes, comparable to the liner Queen Elizabeth 2.','The shield is unworked lunar soil or industrial slag packed between thin spherical shells a few meters outside the rotating habitat, and it does not turn. O’Neill estimated about three million tonnes of it, even in this most efficient shape. Shield thickness is exaggerated in this model.'],
      specs:[['Hull','Aluminum, up to 18 cm at the equator'],['Structural mass','≈100,000 t'],['Shield','Lunar soil or slag, between thin shells'],['Shield mass','≈3 Mt'],['Shield rotation','None']]},
    windows:{name:'Polar windows',kind:'Rotating · glazed bands',sys:'light',blurb:'Where daylight enters, near the axis',
      text:['Near the rotation axis the hull carries only the air pressure, with almost no added load from spin gravity, so the structural analysis puts the windows there.','In O’Neill’s later shielded version, heavy shielding blocks every direct line from the windows to space, so light reaches them only by reflection. That also makes a meteoroid strike on a window far less likely.'],
      specs:[['Location','High latitudes, near the axis'],['Load','Air pressure only'],['Light path','Reflected, no direct view of space']]},
    mirrors:{name:'Ring mirrors',kind:'Non-rotating · external',sys:'light',blurb:'Stationary mirrors that feed the windows',
      text:['A sphere lets every mirror stay stationary in space while the habitat turns inside the light they deliver. O’Neill noted that rotating mirrors could wait for later, larger communities.','External screens let the living sphere and the farm rings keep separate day and night cycles. Mirror shape and size are schematic in this model.'],
      specs:[['Rotation','None'],['Day length','Set by the settlers'],['Shape in model','Conical ring per pole, schematic']]},
    palace:{name:'Crystal Palace rings',kind:'Rotating · farms',sys:'life',blurb:'Glazed farm rings on the axis',
      text:['The farms are a series of partial wheels joined by cables to the rotation axis, named after the glass-and-iron Crystal Palace of the 1851 Great Exhibition. Inside they look like large greenhouses with flat fields at a single level, open enough for harvesting machines as large as any combine.','O’Neill sized the growing area at about a square 0.8 km on a side. Plants tolerate radiation better than people, so the farms need little shielding, though seed crops might be kept inside the protected sphere at first. The rings turn with the sphere as one unit, so the whole community shares one pressure vessel and avoids rotating seals.'],
      specs:[['Growing area','≈0.8 × 0.8 km (≈64 ha)'],['Form','Partial wheels on cables to the axis'],['Shielding','Little needed for plants'],['Rotation','With the sphere'],['Ring count in model','Schematic']]},
    docking:{name:'Axial passages and docks',kind:'On the axis',sys:'transit',blurb:'Where people, freight and heat leave the sphere',
      text:['Large passageways run along the axis, split by a cylindrical shell. Air circulating through them carries heat out to the radiators, and the same corridors move people and freight in weightlessness to the docks and to heavy industry outside.','O’Neill required that the whole population could reach the docking ports for evacuation without any mechanical transport.'],
      specs:[['Location','Rotation axis'],['Carries','People, freight, heated air'],['Evacuation','On foot, to the docking ports']]},
    radiators:{name:'Heat radiators',kind:'Fixed · thermal control',sys:'heat',blurb:'The only way to get rid of heat in vacuum',
      text:['With the sphere fully shielded, the heat that sunlight brings inside has to be removed deliberately. Air moving through the axial passages carries it to external radiators, which shed it to space as infrared light. Placement here is schematic.'],
      specs:[['Heat path','Axial air passages to radiators'],['Heat exit','Radiation only'],['Placement in model','Schematic']]}
  },
  sys:{
    gravity:{note1:'Island One spins at about 1.9 rpm, within the range early studies treated as comfortable, and its small radius makes it the fastest of the three.'},
    transit:{intro:'From the axis, a resident walks down the curved inner surface from the pole to the equator. Weight rises along the way.',button:'Walk to the equator',
      segs:[{n:'Axial passage',len:40,r:()=>0,c:'#55667F'},{n:'Pole to equator, along the wall',len:393,r:s=>250*Math.sin(s/250),c:'#93C76D'}],
      note:'Gravity on the inner surface follows the distance from the axis, which grows with the sine of the arc walked from the pole. The first steps gain weight fastest, and the last stretch to the equator is almost level. O’Neill estimated the walk at about twenty minutes.'},
    light:{kind:'bernal'},
    life:{nodes:{air:['Air','one vessel'],people:['People','10,000'],crops:['Crops','≈64 ha'],water:['Water &','waste'],animals:['Animals','farm rings']},air:null,
      intro:'Island One closes the same loop as any settlement, with the farms in rings outside the living sphere. Select a node to isolate its flows.',
      note:'O’Neill wanted the whole of Island One to turn as a unit inside a single pressure vessel, so the farm rings and the sphere share the same air. External screens still let the farms run their own day length.'},
    shield:{area:4*Math.PI*252*252,design:4.5,designLabel:'Torus study value',hull:null,pop:10000,
      intro:'A sphere encloses its people in the least surface area of any shape. Try the torus study’s shielding on it.',
      note:'At the torus study’s 4.5 t/m², a 500 m sphere needs about 3.6 Mt of shielding, close to O’Neill’s own estimate of three million tonnes, for the same 10,000 people the torus houses behind 9.9 Mt.'},
    heat:{P:60,T:280,label:'Heat to reject (example)'}
  },
  build(root){buildSphere(root,{lake:.03,houses:1100,trees:1300,hs:1,ts:1,industry:false});}
};})();

/* ------------------------------ O'Neill cylinder (Island Three) --- */
const ONEILL=(function(){
  const Rc=32,L=320,SEP=400,CUT=-Math.PI/4,H=.75,ALPHA=26*Math.PI/180; // 1 unit = 100 m
  const STRIPE=Math.PI/3;
  let cylA,cylB,agA;
  return {
  id:'oneill',name:'O’Neill Cylinder',short:'Island Three',year:'1976',unit:'1 unit = 100 m',
  eyebrow:'Island Three · The High Frontier',sub:'High orbit or L5 · several million residents',
  rpm:0.529,floorR:3200,hasShield:false,maxDist:2600,sunDir:[1,.12,.1],
  lede:'Island Three is a coupled pair of cylinders, each about 6.4 km across and 32 km long, turning once every two minutes for Earth-normal gravity. Each interior is divided lengthwise into three valleys and three long windows, with flat mirrors above the windows reflecting in sunlight. O’Neill described it in The High Frontier (1976) as a community of several million people with its own sky, lakes, forests and mountains.',
  figs:[['Diameter','6.4 km'],['Length','32 km'],['Spin','≈0.53 rpm'],['Gravity','≈1 g'],['Valleys','3 per cylinder'],['Residents','several million']],
  compare:{shape:'Coupled pair of cylinders',size:'6.4 × 32 km, ×2',spin:'≈0.53 rpm, opposite senses',gravity:'≈1 g',people:'Several million, up to 10 million',light:'Flat mirrors above window stripes',shield:'Hull, soil and kilometers of air'},
  sources:[['Gerard K. O’Neill, The High Frontier (1976), chapters on Island Three','https://en.wikipedia.org/wiki/The_High_Frontier:_Human_Colonies_in_Space'],['O’Neill cylinder (Wikipedia)','https://en.wikipedia.org/wiki/O%27Neill_cylinder']],
  schematic:'Cylinders and their 80 km spacing at true proportion. Mirror angle, farm cylinders, frame, power mirrors and docking are schematic.',
  order:['land','windows','mirrors','pair','agring','caps','hull'],
  parts:{
    land:{name:'Land valleys',kind:'Rotating · inner surface',sys:'gravity',blurb:'Three valleys running the length of each cylinder',
      text:['Each cylinder is about 6.4 km across and 32 km long, closed by hemispherical end caps, and turns once every two minutes. The circumference is divided into six stripes: three valleys of land alternate with three windows. Each valley is about 3 km wide and runs the full 32 km, rising at both ends into mountains on the end caps up to 3,000 m high.','Looking up from a valley, a resident sees a blue sky, tinted by the windows, and far above the clouds the other two valleys, about as indistinct as the ground seen from an airliner. There is no sensation of rotation, and the Sun appears to stand still while the cylinder turns.','O’Neill imagined small villages separated by forests along the valleys, lakes at the valley ends, and small cities rising into the foothills from the lakeshores.'],
      specs:[['Diameter','≈6.4 km (4 miles)'],['Length','≈32 km (20 miles)'],['Spin','one turn in ≈2 min'],['Gravity','≈1 g'],['Valleys','3, each ≈3 km wide'],['End-cap mountains','up to ≈3,000 m'],['Floor speed','≈180 m/s (400 mph)']]},
    windows:{name:'Window stripes',kind:'Rotating · glazed',sys:'light',blurb:'Three long strips of sky',
      text:['Between the valleys run three window stripes, each as long as the cylinder. They are built of many small panes in metal frames so thin they are invisible from the valley floor, and from a distance the windows appear continuous.','A single blown-out panel would take several years to leak the atmosphere away. The escaping water vapor would make a white plume visible from the sister cylinder, and a patch within the hour would make the loss trivial.'],
      specs:[['Count','3 per cylinder'],['Length','≈32 km'],['Construction','Many small panes in thin frames'],['One panel lost','Years to leak out']]},
    mirrors:{name:'Flat mirrors',kind:'Rotating · adjustable',sys:'light',blurb:'Set dawn, the passage of the Sun, and dusk',
      text:['Three large, light, flat mirrors sit above the windows, held by many cables and rotating with the cylinder. The cylinder axes always point at the Sun, so sunlight runs along the cylinder, strikes the mirrors and reflects in through the windows.','The angle of the light depends only on the lengths of the cables. As the mirrors slowly open in the morning the Sun rises, moving across the sky no faster than it does on Earth. The same schedule of mirror angles sets day length, weather, the seasons and the heat balance of the whole community. A large paraboloidal mirror at the end of each cylinder collects sunlight around the clock for the power plant.'],
      specs:[['Count','3 per cylinder, plus a power mirror'],['Held by','Many cables'],['Controls','Dawn, day length, seasons, heat'],['Angle in model','26°, schematic']]},
    pair:{name:'Coupled pair',kind:'Two cylinders · one frame',sys:'pair',blurb:'Two cylinders cancel each other’s spin',
      text:['A rotating cylinder is an enormous gyroscope, and left alone it keeps pointing the same way relative to the stars. Island Three has to keep its axis toward the Sun, so as it travels around the Sun with the Earth it must turn through a full circle each year, about one degree a day.','The forces needed are tiny, about one ten-millionth of the cylinder’s weight on Earth, applied through hollow bearings at the ends and carried by towers as thin as radio masts. O\u2019Neill attached the towers to a second, identical cylinder spinning the other way, about 80 km (fifty miles) away, one above the plane of Earth\u2019s orbit and one below. The spacing also gives each cylinder\u2019s mirrors room to swing: opened, they reach well over ten kilometers out from the hull. Their gyroscopic effects cancel, so the pair turns together with no energy and no rocket thrust.'],
      specs:[['Cylinders','2, nearly identical'],['Spacing','≈80 km (50 miles)'],['Spin','Equal rates, opposite senses'],['Turning rate','≈1° per day'],['Force needed','≈10⁻⁷ of the cylinder’s Earth weight'],['Fuel needed','None']]},
    agring:{name:'Farm cylinders',kind:'Rotating · agricultural modules',sys:'life',blurb:'Smaller cylinders that grow the food',
      text:['O’Neill moved farming out of the main cylinders into many smaller cylinders nearby. Plants do not need a view or a normal-looking Sun, so the farm cylinders can run at high light intensity, each with its own climate, and the valleys stay free for living and recreation.','Using yields from Richard Bradfield’s multiple-cropping experiments in the Philippines, O’Neill estimated a growing area equal to the living area would feed the population, about a plot 9 m on a side per person. The ring arrangement and pod count in this model are schematic.'],
      specs:[['Location','Near, but outside, the main cylinders'],['Area','≈equal to the living area'],['Per person','≈9 × 9 m of cropland'],['Pods in model','16 per cylinder, schematic']]},
    caps:{name:'End caps and docking',kind:'Axis · spaceport',sys:'transit',blurb:'Where ships arrive and elevators descend',
      text:['Ships dock on the axis at the end caps, where the cylinder’s motion is slowest. From there, elevators run 3.2 km down to the valley floor, and weight builds from nothing to 1 g on the way.','Travel between the two cylinders can use the rotation itself. A vehicle locked to the outside of one cylinder is released at the right moment and flies off in a straight line at the surface speed of about 180 m/s, with no engine needed for the launch.'],
      specs:[['Elevator drop','≈3.2 km'],['Gravity at the axis','0'],['Launch speed from the surface','≈180 m/s']]},
    hull:{name:'Hull, soil and air',kind:'Pressure shell',sys:'shield',blurb:'Protection from the structure itself',
      text:['At this scale the structure itself provides much of the shielding. Radiation reaching a valley passes through the hull and its soil from below, or through kilometers of air from across the cylinder.','O’Neill proposed an oxygen pressure about one fifth of sea level, close to that of Denver, with little nitrogen: lunar sources of nitrogen are scarce, and extra gas would raise the pressure the hull must hold.'],
      specs:[['Oxygen','≈⅕ of sea-level pressure'],['Nitrogen','Kept low'],['Air across the diameter','≈3.8 t/m²']]}
  },
  sys:{
    gravity:{note1:'Island Three’s 3.2 km radius lets it reach 1 g at about half a turn per minute, the gentlest spin of the three.'},
    transit:{intro:'From the dock on the axis, an elevator drops 3.2 km down the end cap to the valley floor.',button:'Ride down the end cap',
      segs:[{n:'Dock',len:300,r:()=>0,c:'#55667F'},{n:'End-cap elevator',len:3200,r:s=>s,c:'#A9CFE6',cor:true},{n:'Valley floor',len:500,r:()=>3200,c:'#93C76D'}],
      note:'The slow spin makes the sideways push in the elevator small, but the drop is long. The valley floor moves at about 180 m/s, which O’Neill proposed using to fling vehicles between the two cylinders.'},
    light:{kind:'oneill'},
    life:{nodes:{air:['Air','O₂ ≈ ⅕ atm'],people:['People','millions'],crops:['Crops','farm cylinders'],water:['Water &','waste'],animals:['Animals','farm cylinders']},
      air:[['O₂',20.3,'o2']],
      intro:'Island Three runs the same loop at the scale of a region, with farming moved out to separate cylinders. Select a node to isolate its flows.',
      note:'O’Neill proposed oxygen at about one fifth of sea-level pressure, about the same as Denver, and kept other gases low. The bar shows that oxygen alone.'},
    shield:{area:2*(2*Math.PI*3200*32000+2*Math.PI*3200*3200),design:3.8,designLabel:'Air across 6.4 km',hull:null,pop:null,
      intro:'Island Three relies on its own structure for protection. See what a torus-style slag shield would cost at this size.',
      note:'Thin habitat air weighs about 0.6 kg per cubic meter, so a path 6.4 km across the cylinder crosses about 3.8 t/m². Wrapping both cylinders in the torus study’s 4.5 t/m² of rock instead would take over six billion tonnes.'},
    pair:{}
  },
  build(root){
    // Settlement axis lies along local Y; rotate so it points along world X, pair side by side along world Z
    const m4=new THREE.Matrix4().makeBasis(V(0,0,1),V(1,0,0),V(0,1,0));root.quaternion.setFromRotationMatrix(m4);
    const OA=V(-SEP,0,0);
    const CLIP=wedge(CUT,H,OA).concat([new THREE.Plane(V(0,-1,0),0)]);
    const mk=(x,sign,cut)=>{
      const g=new THREE.Group();g.position.x=x;root.add(g);world.rotors.push({obj:g,sign});
      const C=m=>cut?clip(m,CLIP):Object.assign(m,{side:THREE.DoubleSide});
      for(let k=0;k<6;k++){
        const ps=k*STRIPE,isLand=k%2===0;
        if(isLand){
          add(new THREE.Mesh(lathe([new THREE.Vector2(Rc,-L/2),new THREE.Vector2(Rc,L/2)],ps,STRIPE,40),C(M('land',{color:0xffffff,map:groundTex(6,40),roughness:.95}))),'land',g);
          add(new THREE.Mesh(lathe([new THREE.Vector2(Rc+.35,-L/2),new THREE.Vector2(Rc+.35,L/2)],ps,STRIPE,40),C(M('hull',{color:0xb4bec8,metalness:.35,roughness:.5}))),'hull',g);
          add(new THREE.Mesh(lathe([new THREE.Vector2(Rc-.04,-L/2),new THREE.Vector2(Rc-.04,L/2)],ps+STRIPE/2-.006,.012,4),C(M('land',{color:0x4f86c6,emissive:0x0d2340,roughness:.3}))),'land',g);
        }else{
          const gt=glassTex(4,60);
          add(new THREE.Mesh(lathe([new THREE.Vector2(Rc+.1,-L/2),new THREE.Vector2(Rc+.1,L/2)],ps,STRIPE,40),C(M('windows',{color:0xffffff,map:gt,emissive:0x2c4d6b,emissiveMap:gt,roughness:.25,metalness:.3}))),'windows',g);
          // hinged mirror, hinged at the anti-sun end (y=-L/2)
          const pg=new THREE.PlaneGeometry(Rc*.98,L*.95);pg.translate(0,L*.95/2,0);
          const mir=new THREE.Mesh(pg,M('mirrors',{color:0xd6e3ee,metalness:.9,roughness:.12,emissive:0x2a3a4c,side:THREE.DoubleSide}));
          const pc=ps+STRIPE/2;mir.position.copy(d(pc).multiplyScalar(Rc+.6)).setY(-L/2);mir.rotation.order='YXZ';mir.rotation.set(ALPHA,pc,0);add(mir,'mirrors',g);
        }
      }
      [1,-1].forEach(s=>{const dome=new THREE.Mesh(new THREE.SphereGeometry(Rc+.35,64,16,0,Math.PI*2,0,Math.PI/2),C(M('caps',{color:0x5a6470,metalness:.2,roughness:.9})));dome.scale.y=.18;dome.position.y=s*L/2;if(s<0)dome.rotation.x=Math.PI;add(dome,'caps',g);
        add(new THREE.Mesh(new THREE.CylinderGeometry(2,2,26,20),M('pair',{color:0x9aa4ae,metalness:.4,roughness:.45})),'pair',g).position.y=s*(L/2+14);});
      return g;
    };
    cylA=mk(-SEP,1,true);cylB=mk(SEP,-1,false);
    // interior of A: towns, trees, clouds
    const rn=rng(23),hs=[],tr=[],cl=[];
    for(let i=0;i<2600;i++){const k=[0,2,4][i%3],phi=k*STRIPE+.04+rn()*(STRIPE-.08),y=-L/2+8+rn()*(L-16),h=.15+rn()*.35,sz=.4+rn()*.6;hs.push([phi,Rc-h/2,y,sz,sz,h]);}
    for(let i=0;i<3200;i++){const k=[0,2,4][i%3],phi=k*STRIPE+.03+rn()*(STRIPE-.06),y=-L/2+6+rn()*(L-12),sz=.35+rn()*.4;tr.push([phi,Rc-sz*.7,y,sz]);}
    for(let i=0;i<70;i++){const phi=rn()*Math.PI*2,y=-L/2+20+rn()*(L-40),sz=1+rn()*1.4;cl.push([phi,Rc-10-rn()*6,y,sz*1.4,sz*2.4,sz*.35]);}
    const box=new THREE.BoxGeometry(1,1,1);
    instanced(hs,box,clip(M('land',{color:0xdcd7c8,roughness:.8}),CLIP),'land',cylA,placeBox);
    instanced(tr,new THREE.IcosahedronGeometry(1,0),clip(M('land',{color:0x4c7a3c,roughness:.9,flatShading:true}),CLIP),'land',cylA,placeBlob);
    const clouds=instanced(cl,new THREE.IcosahedronGeometry(1,1),clip(M('land',{color:0xf4f7fa,roughness:1,transparent:true,opacity:.8}),CLIP),'land',cylA,placeBlob);clouds.raycast=()=>{};
    // agricultural rings at the sunward end
    [[-SEP,1],[SEP,-1]].forEach(([x,s],j)=>{const g=new THREE.Group();g.position.set(x,L/2+22,0);root.add(g);world.rotors.push({obj:g,sign:s*1.3});if(j===0)agA=g;
      const pm=M('agring',{color:0x8fc27a,roughness:.35,metalness:.2,emissive:0x16290f}),fm=M('agring',{color:0x9aa4ae,metalness:.4});
      const ring=new THREE.Mesh(new THREE.TorusGeometry(44,.5,6,120),fm);ring.rotation.x=Math.PI/2;add(ring,'agring',g);
      for(let k=0;k<16;k++){const a=k*Math.PI/8,p=new THREE.Mesh(new THREE.CylinderGeometry(3,3,11,24),pm);p.position.copy(d(a).multiplyScalar(44));add(p,'agring',g);
        const sp=new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,42,6),fm);sp.position.copy(d(a).multiplyScalar(21));sp.rotation.z=Math.PI/2;sp.rotation.y=a-Math.PI/2;g.add(sp);}});
    // paraboloidal power mirrors at the sunward ends
    [-SEP,SEP].forEach(x=>{const dish=new THREE.Mesh(new THREE.SphereGeometry(30,48,12,0,Math.PI*2,0,.55),M('caps',{color:0xd6e3ee,metalness:.85,roughness:.2,emissive:0x1b2633,side:THREE.DoubleSide}));dish.rotation.x=Math.PI;dish.position.set(x,L/2+72,0);add(dish,'mirrors',root);
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.8,.8,40,8),M('pair',{color:0x9aa4ae}));st.position.set(x,L/2+46,0);root.add(st);});
    // frame joining the pair, docks at the anti-sun end
    const fr=M('pair',{color:0x9aa4ae,metalness:.4,roughness:.45});
    [1,-1].forEach(s=>{const b=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.4,SEP*2,12),fr);b.rotation.z=Math.PI/2;b.position.y=s*(L/2+27);add(b,'pair',root);
      [-SEP,SEP].forEach(x=>{const k=new THREE.Mesh(new THREE.SphereGeometry(3,16,12),fr);k.position.set(x,s*(L/2+27),0);add(k,'pair',root);});});
    [-SEP,SEP].forEach(x=>{const dk=new THREE.Mesh(new THREE.CylinderGeometry(2.6,2.6,8,20),M('caps',{color:0xc4ccd4,metalness:.4}));dk.position.set(x,-(L/2+34),0);add(dk,'caps',root);
      const sh=new THREE.Mesh(new THREE.ConeGeometry(1.5,5,12),M('caps',{color:0xe9e2d0}));sh.position.set(x,-(L/2+41),0);sh.rotation.x=Math.PI;add(sh,'caps',root);});
    world.sunPos=V(0,2600,200); // local +Y, transformed with root below
    const A=(a,rho,y)=>at(a,rho,y).add(OA);
    const mirMid=(()=>{const pc=Math.PI/2,s=L*.95/2;return d(pc).multiplyScalar(Rc+.6+s*Math.sin(ALPHA)).setY(-L/2+s*Math.cos(ALPHA));})();
    world.views={overview:{cam:V(-SEP-620,380,520),tgt:V(-SEP*.55,-20,0)},
      land:{cam:A(CUT,20,140),tgt:A(CUT+Math.PI,24,20)},windows:{cam:V(SEP+150,-20,70),tgt:V(SEP+30,-20,0)},
      mirrors:{cam:V(SEP+330,-360,300),tgt:V(SEP+60,-40,0)},pair:{cam:V(-60,-260,1450),tgt:V(0,0,0)},
      agring:{cam:V(-SEP-150,L/2+150,170),tgt:V(-SEP,L/2+20,0)},caps:{cam:V(-SEP-80,-L/2-110,90),tgt:V(-SEP,-L/2-15,0)},
      hull:{cam:A(CUT-.1,Rc+40,40),tgt:A(CUT+H,Rc,20)}};
    world.anchors={land:A(CUT+Math.PI,Rc-1,110),windows:[cylB,at(Math.PI/2,Rc,-60)],mirrors:[cylB,mirMid],pair:V(0,L/2+27,0),
      agring:[agA,at(Math.PI*1.5,44,0)],caps:V(-SEP,-(L/2+34),0),hull:A(CUT+H+.25,Rc+.4,-40)};
  }
};})();

/* ------------------------------ Island Two -------------------------- */
const ISLAND2={
  id:'island2',name:'Island Two',short:'Island Two',year:'1976',unit:'1 unit = 18 m',
  eyebrow:'Island Two · The High Frontier',sub:'High orbit · 140,000 residents',
  rpm:1.0,floorR:900,hasShield:true,maxDist:700,sunDir:[.15,1,.25],
  lede:'Island Two is the next step in size after Island One: a Bernal sphere close to 1,800 m across with an equatorial circumference of nearly four miles, for about 140,000 people. O’Neill imagined it built only after a dozen or so Island Ones existed, then replicated in series with automated machinery and dry docks, its heavy industry and farms kept outside the living sphere.',
  figs:[['Diameter','≈1,800 m'],['Equator','≈6 km'],['Residents','140,000'],['Living area','≈7 km²'],['Spin for 1 g','≈1 rpm'],['Replication','≈2 years']],
  compare:{shape:'Large sphere',size:'≈1.8 km across',spin:'≈1 rpm (calculated)',gravity:'1 g at equator',people:'140,000',light:'Mirrors, as Island One',shield:'Lunar or asteroidal material'},
  sources:[['Gerard K. O’Neill, The High Frontier (1976), chapters on growth and Island Two','https://en.wikipedia.org/wiki/The_High_Frontier:_Human_Colonies_in_Space']],
  schematic:'Sphere at true proportion, drawn with the Island One layout. O’Neill gives no spin rate, shielding or mirror details for Island Two, so those are carried over from Island One and marked as calculated or schematic.',
  order:['valley','shell','windows','mirrors','palace','industry','docking','radiators'],
  parts:{
    valley:{name:'Villages and lake',kind:'Rotating · inner surface',sys:'gravity',blurb:'Hill-town villages around an equatorial lake',
      text:['O’Neill pictured 140,000 people living in a number of small villages separated by park or forest, each about the size and density of a small Italian hill town. The living area comes to almost seven square kilometers.','There is room for a lake, with beaches lapped by waves perhaps large enough for surfing, where Island One had only a small river. In the colonist’s letter in The High Frontier, Island Two runs a climate right for pine trees and firs, and a caption imagines an Island Two of the year 2100, mainly forested, as a refuge for endangered species.'],
      specs:[['Residents','140,000'],['Living area','≈7 km²'],['Diameter','≈1,800 m'],['Equator','nearly 4 miles (≈6 km)'],['Air pressure','like Denver or Mexico City'],['Spin for 1 g','≈1 rpm (calculated, not stated)']]},
    shell:{name:'Hull and shield',kind:'Pressure shell · shielding',sys:'shield',blurb:'Several million tonnes of structure',
      text:['Each Island Two sphere has a structural mass of several million tons. Island One weighs less than half as much per person, so the larger sphere costs more structure for each resident even as it gains open space.','The book does not detail the shield. This model carries over Island One’s non-rotating shell of lunar material, with its thickness exaggerated so it reads at the cut. O’Neill noted that an asteroid chunk a few city blocks across could supply the material.'],
      specs:[['Structure','several million tons'],['Per person','about twice Island One’s'],['Shield in model','carried over from Island One']]},
    windows:{name:'Polar windows',kind:'Rotating · glazed bands',sys:'light',blurb:'Daylight enters near the axis',
      text:['The book gives no window layout for Island Two. The model uses Island One’s arrangement, with glazing near the poles where the hull carries little spin load. The colonist’s letter mentions sunshine arriving almost overhead and falling through gaps between apartments onto planters outside long windows.'],
      specs:[['Layout in model','as Island One'],['Source detail','colonist’s letter only']]},
    mirrors:{name:'Ring mirrors',kind:'Non-rotating · external',sys:'light',blurb:'Stationary mirrors that feed the windows',
      text:['Island Two’s mirrors are not described in detail. Like Island One, a sphere allows the mirrors to stay stationary while the habitat turns inside the light. Mirror shape and size are schematic.'],
      specs:[['Rotation','None'],['In model','as Island One, schematic']]},
    palace:{name:'Outside farms',kind:'Rotating · agriculture',sys:'life',blurb:'Farms kept outside the living sphere',
      text:['As in Island One, agriculture sits outside the living area. Separate farm volumes can run hot, bright and rich in carbon dioxide while the sphere stays comfortable for people. The ring form is carried over from Island One’s Crystal Palace and is schematic.'],
      specs:[['Location','Outside the living sphere'],['Form in model','Crystal Palace rings, schematic']]},
    industry:{name:'Zero-g industry',kind:'Fixed · outside the sphere',sys:'heat',blurb:'Heavy industry a few hundred meters away',
      text:['All of Island Two’s heavy industry is located outside, at least a few hundred meters away, in zero gravity. O’Neill suggested that Island Two units could be sold as turnkey industrial facilities, and that the replication cycle could be as short as two years.'],
      specs:[['Distance','a few hundred meters'],['Gravity','zero'],['Replication cycle','as short as 2 years']]},
    docking:{name:'Axial docking',kind:'On the axis',sys:'transit',blurb:'Ships arrive where nothing moves',
      text:['As in every rotating settlement, ships dock on the axis, where the surface speed is zero. From the pole a resident descends the curved inner surface about 1.4 km to the equator, gaining weight the whole way.'],
      specs:[['Location','Rotation axis'],['Pole to equator','≈1.4 km along the wall']]},
    radiators:{name:'Heat radiators',kind:'Fixed · thermal control',sys:'heat',blurb:'The only way to get rid of heat in vacuum',
      text:['Heat from sunlight, machines and 140,000 people has to leave by radiation. Placement in the model is schematic, carried over from Island One.'],
      specs:[['Heat exit','Radiation only'],['Placement in model','Schematic']]}
  },
  sys:{
    gravity:{note1:'O’Neill gives no spin rate for Island Two. About 1 rpm is what a 900 m radius needs for 1 g, and the colonist’s letter reports that almost no one feels any dizziness in a habitat that big.'},
    transit:{intro:'From the axis, a resident walks down the curved inner surface from the pole to the equator, about 1.4 km.',button:'Walk to the equator',
      segs:[{n:'Axial passage',len:60,r:()=>0,c:'#55667F'},{n:'Pole to equator, along the wall',len:1414,r:s=>900*Math.sin(s/900),c:'#93C76D'}],
      note:'At this size the slope from pole to equator is gentle, and the weight gain is spread over more than a kilometer of walking.'},
    light:{kind:'bernal'},
    life:{nodes:{air:['Air','like Denver'],people:['People','140,000'],crops:['Crops','outside'],water:['Water &','waste'],animals:['Animals','outside']},air:null,
      intro:'Island Two closes the same loop as Island One at fourteen times the population, with farms outside the living sphere. Select a node to isolate its flows.',
      note:'O’Neill set the air pressure about like Denver or Mexico City. Lake, forests and outside farms all take part in the water and carbon cycles.'},
    shield:{area:4*Math.PI*902*902,design:4.5,designLabel:'Torus study value',hull:null,pop:140000,
      intro:'A larger sphere has less surface per person. Try the torus study’s shielding on Island Two.',
      note:'At 4.5 t/m² a sphere 1.8 km across needs about 46 Mt of shielding, roughly 330 t per resident against the torus study’s 990 t. Size works in shielding’s favor, though O’Neill notes that the structure itself grows heavier per person.'},
    heat:{P:300,T:280,label:'Heat to reject (example)'}
  },
  build(root){buildSphere(root,{lake:.1,houses:2600,trees:3200,hs:.45,ts:.5,industry:true});}
};

/* ------------------------------ Model One --------------------------- */
const MODEL1=(function(){
  const Rc=10,LH=32,PHI_C=Math.PI/4,H=.7,STRIPE=Math.PI/3,ALPHA=22*Math.PI/180; // 1 unit = 10 m
  const capArc=(rad,t0,t1,yc,n)=>{const p=[];n=n||24;for(let i=0;i<=n;i++){const t=t0+(t1-t0)*i/n;p.push(new THREE.Vector2(rad*Math.cos(t),yc+rad*Math.sin(t)));}return p;};
  return {
  id:'model1',name:'Model One',short:'Model One',year:'1976',unit:'1 unit = 10 m',
  eyebrow:'Shielded Model One · The High Frontier',sub:'An early habitat design · dimensions scaled from the drawing',
  rpm:3.0,floorR:100,hasShield:true,maxDist:600,sunDir:[.15,1,.25],
  lede:'Model One appears in The High Frontier as two drawings with a caption: “Shielded ‘Model One,’ an early habitat design with farms in cylinder valleys, living areas in shielded end-caps.” It sits in O’Neill’s chapter on risks, beside his account of how much shielding a first habitat needs. The book gives no figures, so this model is scaled from the drawing’s 600 m scale bar.',
  figs:[['Diameter','≈200 m'],['Length','≈850 m'],['Living','end caps'],['Farms','cylinder valleys'],['Shield','≈2 m of soil'],['Spin for 1 g','≈3 rpm']],
  compare:{shape:'Cylinder with shielded end caps',size:'≈200 × 850 m (scaled)',spin:'≈3 rpm (calculated)',gravity:'≈1 g in the caps',people:'Not stated',light:'Collar mirrors into caps, strip mirrors on farms',shield:'End caps only, ≈2 m of soil'},
  sources:[['Gerard K. O’Neill, The High Frontier (1976), chapter 7 “Risks and Dangers”, figures on pp. 106–109','https://en.wikipedia.org/wiki/The_High_Frontier:_Human_Colonies_in_Space']],
  schematic:'Everything here is scaled from O’Neill’s drawing against its 600 m scale bar, so treat dimensions as approximate. Spin rate and population are not stated in the book.',
  order:['caps','capshield','farms','windows','strips','collars','docking','lower'],
  parts:{
    caps:{name:'Living end caps',kind:'Rotating · shielded',sys:'gravity',blurb:'Homes concentrated where shielding is easiest',
      text:['Model One puts its people in the two hemispherical end caps of a rotating cylinder. Concentrating the living area there keeps the heavily shielded part of the habitat small.','Scaled from the drawing, the cylinder is about 200 m across and the habitat about 850 m from cap to cap. For 1 g at a 100 m radius it would have to turn about 3 rpm, three times the torus study’s limit, though within the range early studies found people could adapt to. The book does not give the spin rate.'],
      specs:[['Living area','two end caps'],['Diameter','≈200 m (scaled)'],['Length','≈850 m cap to cap (scaled)'],['Spin for 1 g','≈3 rpm (calculated)'],['Population','not stated']]},
    capshield:{name:'Cap shielding',kind:'Non-rotating · lunar soil',sys:'shield',blurb:'Two meters of soil over the living areas',
      text:['O’Neill’s chapter on risks works through the radiation problem beside this drawing. Fifty centimeters of sand would stop solar flares but make galactic cosmic rays worse, because heavy particles break up into showers of lighter ones in dense matter. The full requirement is about two meters of soil.','The caption marks only the end caps as shielded. Elsewhere O’Neill notes that plants tolerate radiation better than people, which is what lets farms sit outside the heaviest shielding. The shield in the model is drawn non-rotating, as in his other designs.'],
      specs:[['Requirement','≈2 m of soil'],['Covers','the living end caps'],['Half measure','50 cm stops flares, worsens cosmic rays']]},
    farms:{name:'Farm valleys',kind:'Rotating · cylinder body',sys:'life',blurb:'Crops in the valleys of the cylinder',
      text:['The cylinder between the caps holds the farms, laid out in valleys that alternate with window stripes. O’Neill later used the same valley and window arrangement, at a vastly larger scale, for the living land of Island Three.'],
      specs:[['Location','cylinder body'],['Layout','3 valleys, 3 windows (as drawn)'],['Length','≈640 m (scaled)']]},
    windows:{name:'Window stripes',kind:'Rotating · glazed',sys:'light',blurb:'Light into the farm valleys',
      text:['Window stripes run along the cylinder between the farm valleys, letting in light reflected by the strip mirrors. The drawing shows the stripes; their construction is not described.'],
      specs:[['Count in model','3'],['Feeds','farm valleys']]},
    strips:{name:'Strip mirrors',kind:'Rotating · long flat mirrors',sys:'light',blurb:'Reflect sunlight onto the farms',
      text:['Long flat mirrors stand off the cylinder beside the windows, catching sunlight that runs along the axis and reflecting it in, the same principle O’Neill used for Island Three. The light-path drawing shows a long diagonal mirror sending light into the cylinder.'],
      specs:[['Count in model','3'],['Angle in model','22°, schematic']]},
    collars:{name:'Collar mirrors',kind:'Non-rotating · conical',sys:'light',blurb:'Turn sunlight into the shielded caps',
      text:['Funnel-shaped collars ring each end cap, with a broad open bowl below the lower one. In the sunlight-path drawing, light arrives along the axis, strikes these mirrors and is turned into the caps, bouncing between mirrors before it reaches the living floor so that no straight path from space crosses the shielding.'],
      specs:[['Shape','conical collars and an open bowl'],['Role','light into the living caps'],['Size in model','scaled from the drawing']]},
    docking:{name:'Docking module',kind:'On the axis · top',sys:'transit',blurb:'Ships arrive on a mast above the upper cap',
      text:['The drawing shows a docking module on a mast above the upper cap, on the rotation axis. From there a resident would descend the inside of the cap from its pole to its rim, gaining weight as the distance from the axis grows.'],
      specs:[['Location','axis, above the upper cap'],['Cap pole to rim','≈160 m along the wall']]},
    lower:{name:'Lower sphere',kind:'On the axis · bottom',sys:'heat',blurb:'An external sphere on a long mast',
      text:['A sphere about 150 m across hangs on a mast below the habitat. The caption does not say what it is. In O’Neill’s other designs, heavy industry and the radiators that shed waste heat sit outside the habitat on its axis, in the same position.'],
      specs:[['Diameter','≈150 m (scaled)'],['Function','not stated']]}
  },
  sys:{
    gravity:{note1:'The book gives no spin for Model One. Its small radius needs about 3 rpm for 1 g, the fastest of the five designs here.'},
    transit:{intro:'From the dock on the axis, a resident descends the inside of an end cap from its pole to its rim.',button:'Descend the cap',
      segs:[{n:'Dock and mast',len:60,r:()=>0,c:'#55667F'},{n:'Cap pole to rim, along the wall',len:157,r:s=>100*Math.sin(s/100),c:'#93C76D'}],
      note:'In a habitat this small, weight changes quickly over a short walk, and the Coriolis effect is three times stronger than in the torus for the same walking speed.'},
    light:{kind:'model1'},
    life:{nodes:{air:['Air','one vessel'],people:['People','end caps'],crops:['Crops','valleys'],water:['Water &','waste'],animals:['Animals','valleys']},air:null,
      intro:'Model One keeps people and farms in one rotating vessel, separated by function: living in the caps, growing in the cylinder. Select a node to isolate its flows.',
      note:'The book gives no life-support details for Model One. The loop is the one every settlement shares.'},
    shield:{area:4*Math.PI*102*102,design:3.0,designLabel:'2 m of soil (≈1.5 t/m³)',hull:null,pop:null,
      intro:'Shielding only the end caps keeps the shielded area small. Try different areal masses on the caps alone.',
      note:'Two meters of soil at an assumed 1.5 t/m³ is about 3 t/m². Over the two caps, about 0.13 km², that comes to roughly 0.4 Mt, a small fraction of the torus shield, bought by confining people to the caps.'},
    heat:{P:20,T:280,label:'Heat to reject (example)'}
  },
  build(root){
    const NARROW=wedge(PHI_C,H);
    const rot=new THREE.Group();root.add(rot);world.rotors.push({obj:rot,sign:1});
    const C=m=>clip(m,NARROW);
    for(let k=0;k<6;k++){const ps=k*STRIPE;
      if(k%2===0){
        const crops=canvasTex(64,16,(g,w,h)=>{for(let i=0;i<8;i++){g.fillStyle=i%2?'#5f9a3f':'#7fb552';g.fillRect(i*8,0,8,h);}},3,40);
        add(new THREE.Mesh(lathe([new THREE.Vector2(Rc,-LH),new THREE.Vector2(Rc,LH)],ps,STRIPE,30),C(M('farms',{color:0xffffff,map:crops,roughness:.9}))),'farms',rot);
        add(new THREE.Mesh(lathe([new THREE.Vector2(Rc+.2,-LH),new THREE.Vector2(Rc+.2,LH)],ps,STRIPE,30),C(M('farms',{color:0xb4bec8,metalness:.35,roughness:.5}))),'farms',rot);
      }else{
        const gt=glassTex(3,24);
        add(new THREE.Mesh(lathe([new THREE.Vector2(Rc+.1,-LH),new THREE.Vector2(Rc+.1,LH)],ps,STRIPE,30),C(M('windows',{color:0xffffff,map:gt,emissive:0x2c4d6b,emissiveMap:gt,roughness:.25,metalness:.3}))),'windows',rot);
        const pg=new THREE.PlaneGeometry(Rc*.9,LH*1.9);pg.translate(0,LH*1.9/2,0);
        const mir=new THREE.Mesh(pg,M('strips',{color:0xd6e3ee,metalness:.9,roughness:.12,emissive:0x2a3a4c,side:THREE.DoubleSide}));
        const pc=ps+STRIPE/2;mir.position.copy(d(pc).multiplyScalar(Rc+.6)).setY(-LH);mir.rotation.order='YXZ';mir.rotation.set(ALPHA,pc,0);add(mir,'strips',rot);
      }}
    // living end caps: hull, interior land, houses
    const hullOut={color:0xb4bec8,metalness:.35,roughness:.5},hullIn={color:0x3a4659,roughness:.85};
    const rn=rng(31),hs=[],tr=[];
    [1,-1].forEach(s=>{
      const t0=s>0?0:-Math.PI/2,t1=s>0?Math.PI/2:0,yc=s*LH;
      add(new THREE.Mesh(lathe(capArc(Rc,t0,t1,yc),0,Math.PI*2,120),C(M('caps',hullOut))),'caps',rot);
      add(new THREE.Mesh(lathe(capArc(Rc-.2,t0,t1,yc),0,Math.PI*2,120),C(M('caps',hullIn))),'caps',rot);
      const l0=s>0?0:-1.05,l1=s>0?1.05:0;
      add(new THREE.Mesh(lathe(capArc(Rc-.25,l0,l1,yc),0,Math.PI*2,120),C(M('caps',{color:0xffffff,map:groundTex(30,4),roughness:.95}))),'caps',rot);
      for(let i=0;i<260;i++){const la=s*(.05+rn()*.9),y=yc+(Rc-.25)*Math.sin(la),rhoS=(Rc-.25)*Math.cos(la),h=.25+rn()*.45,sz=.3+rn()*.35;hs.push([rn()*Math.PI*2,rhoS-h/2+.05,y,sz,sz,h]);}
      for(let i=0;i<260;i++){const la=s*(.05+rn()*.95),y=yc+(Rc-.25)*Math.sin(la),rhoS=(Rc-.25)*Math.cos(la),sz=.15+rn()*.15;tr.push([rn()*Math.PI*2,rhoS-sz*.8,y,sz]);}
    });
    const box=new THREE.BoxGeometry(1,1,1);
    instanced(hs,box,C(M('caps',{color:0xdcd7c8,roughness:.8})),'caps',rot,placeBox);
    instanced(tr,new THREE.IcosahedronGeometry(1,0),C(M('caps',{color:0x4c7a3c,roughness:.9,flatShading:true})),'caps',rot,placeBlob);
    // non-rotating cap shields, leaving a ring of light near the cap rim
    const shO={color:0xffffff,map:rockTex(30,4),roughness:1},shI={color:0x4a443d,roughness:1};
    [1,-1].forEach(s=>{const t0=s>0?.32:-Math.PI/2+.12,t1=s>0?Math.PI/2-.12:-.32,yc=s*LH;
      [[Rc+1.2,shO],[Rc+.6,shI]].forEach(([rad,o])=>world.shieldMeshes.push(add(new THREE.Mesh(lathe(capArc(rad,t0,t1,yc),0,Math.PI*2,120),C(M('capshield',o))),'capshield',root)));
      [PHI_C-H,PHI_C+H].forEach(a=>{const c=new THREE.Mesh(new THREE.ShapeGeometry(shapeFrom(capArc(Rc+1.2,t0,t1,yc,20),capArc(Rc+.6,t0,t1,yc,20))),M('capshield',{color:0xb3a184,side:THREE.DoubleSide}));c.rotation.y=a-Math.PI/2;add(c,'capshield',root);world.capMeshes.push(c);world.shieldMeshes.push(c);});
    });
    // collar mirrors and lower bowl
    const mm={color:0xd6e3ee,metalness:.9,roughness:.12,emissive:0x1b2633,side:THREE.DoubleSide};
    add(new THREE.Mesh(new THREE.CylinderGeometry(17,11,7,72,1,true),M('collars',mm)),'collars',root).position.y=LH+1.5;
    add(new THREE.Mesh(new THREE.CylinderGeometry(20,11,8,72,1,true),M('collars',mm)),'collars',root).position.y=-LH+1;
    add(new THREE.Mesh(new THREE.CylinderGeometry(32,27,9,96,1,true,0,Math.PI*1.6),M('collars',mm)),'collars',root).position.y=-LH-10;
    // docking and lower sphere
    const mast=M('docking',{color:0x9aa4ae,metalness:.4,roughness:.45});
    add(new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,16,8),mast),'docking',root).position.y=LH+Rc+8;
    add(new THREE.Mesh(new THREE.BoxGeometry(3,3,4),M('docking',{color:0xc4ccd4,metalness:.4})),'docking',root).position.y=LH+Rc+17;
    add(new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,22,8),M('lower',{color:0x9aa4ae,metalness:.4})),'lower',root).position.y=-LH-Rc-11;
    add(new THREE.Mesh(new THREE.SphereGeometry(7.5,32,20),M('lower',{color:0xb9c3cc,metalness:.35,roughness:.45})),'lower',root).position.y=-LH-Rc-29;
    world.sunPos=V(300,2600,500);
    world.views={overview:{cam:at(PHI_C,215,70),tgt:V(0,-8,0)},
      caps:{cam:at(PHI_C,26,40),tgt:at(PHI_C+Math.PI,5,LH+2)},capshield:{cam:at(PHI_C+.2,26,40),tgt:at(PHI_C+H,Rc,LH+5)},
      farms:{cam:at(PHI_C,24,6),tgt:at(PHI_C+Math.PI,6,-10)},windows:{cam:at(PHI_C-1.3,42,0),tgt:V(0,0,0)},
      strips:{cam:at(PHI_C+.9,95,-30),tgt:V(0,4,0)},collars:{cam:at(PHI_C,52,58),tgt:V(0,LH,0)},
      docking:{cam:at(PHI_C,24,LH+28),tgt:V(0,LH+16,0)},lower:{cam:at(PHI_C,40,-LH-40),tgt:V(0,-LH-26,0)}};
    world.anchors={caps:at(PHI_C+2.6,Rc-.5,LH+3),capshield:at(PHI_C+1.8,Rc+1.2,LH+5),farms:at(PHI_C+2.8,Rc-.3,-8),windows:[rot,at(Math.PI/2,Rc,8)],
      strips:[rot,d(Math.PI/2).multiplyScalar(Rc+.6+LH*.95*Math.sin(ALPHA)).setY(-LH+LH*.95*Math.cos(ALPHA))],collars:at(PHI_C-.7,17,LH+5),docking:V(0,LH+17,1.5),lower:at(PHI_C,7.5,-LH-Rc-29)};
  }
};})();

const SETTLEMENTS={torus:TORUS,bernal:BERNAL,island2:ISLAND2,oneill:ONEILL,model1:MODEL1};
const SET_ORDER=['torus','model1','bernal','island2','oneill'];
let S=TORUS;

/* ================================================================== */
/*  Renderer and scene                                                 */
/* ================================================================== */
const stage=$('stage'),canvas=$('gl'),panel=$('panel');
let renderer,scene,camera,controls,sunLight,sunSprite;
let showCut=true,showShield=true,showLabels=true,spinMult=1;
const prefersReduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
if(prefersReduced)spinMult=0;

function initScene(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.localClippingEnabled=true;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x060a13);
  camera=new THREE.PerspectiveCamera(38,1,.3,12000);
  controls=new THREE.OrbitControls(camera,canvas);
  controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=5;controls.rotateSpeed=.6;
  controls.addEventListener('start',()=>{fly=null;});
  scene.add(new THREE.HemisphereLight(0xc4d6ec,0x1d2230,.75));
  sunLight=new THREE.DirectionalLight(0xfff0d8,1.35);scene.add(sunLight);
  const fill=new THREE.DirectionalLight(0x7d93b5,.45);fill.position.set(-200,-120,-160);scene.add(fill);
  const sg=new THREE.BufferGeometry(),sp=[],rn=rng(7);
  for(let i=0;i<2400;i++){const u=rn()*2-1,th=rn()*Math.PI*2,rr=5000+rn()*2500,s=Math.sqrt(1-u*u);sp.push(rr*s*Math.cos(th),rr*u,rr*s*Math.sin(th));}
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xa9b8cc,size:1.5,sizeAttenuation:false})));
  const sunTex=canvasTex(128,128,(g,w,h)=>{const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,248,225,1)');gr.addColorStop(.25,'rgba(255,214,140,.55)');gr.addColorStop(1,'rgba(255,190,100,0)');g.fillStyle=gr;g.fillRect(0,0,w,h);},1,1);
  sunSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:sunTex,depthWrite:false,transparent:true}));sunSprite.scale.set(300,300,1);scene.add(sunSprite);
}

function disposeWorld(){
  if(!world)return;
  scene.remove(world.root);
  world.root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){[].concat(o.material).forEach(m=>{if(m.map)m.map.dispose();if(m.emissiveMap)m.emissiveMap.dispose();m.dispose();});}});
}
function loadSettlement(id){
  S=SETTLEMENTS[id]||TORUS;
  state.sel=null;state.hover=null;openSys=null;align=null;
  if(HAS3D&&renderer){
    disposeWorld();
    world={root:new THREE.Group(),rotors:[],clipMats:[],capMeshes:[],shieldMeshes:[],pickables:[],partMats:{},lightGroup:null,lightParts:[],views:{},anchors:{}};
    scene.add(world.root);
    S.build(world.root);
    world.root.updateMatrixWorld(true);
    const mw=world.root.matrixWorld;
    world.clipMats.forEach(m=>{m.userData.planes=m.userData.lp.map(p=>p.clone().applyMatrix4(mw));m.clippingPlanes=showCut?m.userData.planes:null;m.needsUpdate=true;});
    world.capMeshes.forEach(c=>c.visible=showCut&&(world.shieldMeshes.indexOf(c)<0||showShield));
    world.shieldMeshes.forEach(m=>m.visible=showShield&&(world.capMeshes.indexOf(m)<0||showCut));
    const sp=world.root.localToWorld(world.sunPos.clone());sunSprite.position.copy(sp);sunLight.position.copy(sp.clone().normalize().multiplyScalar(400)).add(V(0,120,60));
    controls.maxDistance=S.maxDist;
    const v=viewW('overview');camera.position.copy(v.cam);controls.target.copy(v.tgt);fly=null;
    buildLabels();paint();
  }
  $('tShield').disabled=!S.hasShield;
  if(typeof endTour==='function')endTour();$('tTour').hidden=!S.tour;
  $('plEyebrow').textContent='Space Settlements · '+S.eyebrow;
  $('plName').textContent=S.name;
  $('plSub').textContent=S.sub+' · '+S.unit;
  stage.setAttribute('aria-label','3D cutaway of the '+S.name);
  setSpin(spinMult);
  renderOverview();
  try{if(location.hash!=='#'+S.id)history.replaceState(null,'','#'+S.id);}catch(e){}
}
function viewW(id){const v=world.views[id]||world.views.overview;return{cam:world.root.localToWorld(v.cam.clone()),tgt:world.root.localToWorld(v.tgt.clone())};}
function anchorW(id){const a=world.anchors[id];if(Array.isArray(a))return a[0].localToWorld(a[1].clone());return world.root.localToWorld(a.clone());}

/* ================================================================== */
/*  Selection, camera moves                                            */
/* ================================================================== */
const state={sel:null,hover:null};
let fly=null,align=null,openSys=null;
const AMBER=HAS3D?new THREE.Color(0xf2a541):null;
function paint(){
  if(!world)return;
  for(const id in world.partMats){const k=id===state.sel?.24:(id===state.hover?.12:0);
    world.partMats[id].forEach(m=>{m.emissive.copy(m.userData.base);if(k)m.emissive.add(AMBER.clone().multiplyScalar(k));});}
  if(world.lightGroup)world.lightGroup.visible=world.lightParts.indexOf(state.sel)>=0||openSys==='light';
}
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
function flyTo(v){if(camera)fly={t:0,dur:1.3,c0:camera.position.clone(),t0:controls.target.clone(),c1:v.cam,t1:v.tgt};}
const API={alignRotor(obj,centers,target){let best=null;centers.forEach(c=>{let dl=(target-c)-obj.rotation.y;dl=((dl%(2*Math.PI))+3*Math.PI)%(2*Math.PI)-Math.PI;if(best===null||Math.abs(dl)<Math.abs(best))best=dl;});align={obj,t:0,dur:1.3,a0:obj.rotation.y,a1:obj.rotation.y+best};setSpin(0);}};
function select(id){
  state.sel=id;openSys=id?S.parts[id].sys:null;
  if(world){paint();
    if(id){flyTo(viewW(id));if(S.onSelect)S.onSelect(id,API);if(S.hasShield&&!showShield&&(id==='shield'||id==='shell'))toggleShield();}
    else flyTo(viewW('overview'));
    updateLabelClasses();}
  if(id)renderPart(id);else renderOverview();
}

/* ================================================================== */
/*  Callouts                                                           */
/* ================================================================== */
const labelsEl=$('labels'),leaders=$('leaders');let LBL={};
function buildLabels(){
  labelsEl.innerHTML='';leaders.innerHTML='';LBL={};
  const NS='http://www.w3.org/2000/svg';
  S.order.forEach((id,i)=>{
    const p=S.parts[id],b=document.createElement('button');b.className='lbl';b.type='button';
    b.innerHTML=`<span class="n">${code(i)}</span><span class="t">${p.name}</span>`;
    b.addEventListener('click',()=>select(id));
    b.addEventListener('mouseenter',()=>{state.hover=id;paint();});b.addEventListener('mouseleave',()=>{state.hover=null;paint();});
    labelsEl.appendChild(b);
    const g=document.createElementNS(NS,'g'),pl=document.createElementNS(NS,'polyline'),c=document.createElementNS(NS,'circle');c.setAttribute('r','2.6');g.append(pl,c);leaders.appendChild(g);
    LBL[id]={el:b,g,pl,c,side:null,w:0,h:0};
  });
  measure();updateLabelClasses();
}
const code=i=>String(i+1).padStart(2,'0');
function measure(){const narrow=stage.clientWidth<640;Object.values(LBL).forEach(L=>{L.el.querySelector('.t').hidden=narrow;L.w=L.el.offsetWidth;L.h=L.el.offsetHeight;});}
function updateLabelClasses(){Object.keys(LBL).forEach(id=>{const L=LBL[id],on=id===state.sel,dim=state.sel&&!on;L.el.classList.toggle('on',on);L.el.classList.toggle('dim',!!dim);L.g.setAttribute('class',on?'on':(dim?'dim':''));});}
let tmp;
function layoutLabels(){
  const W=stage.clientWidth,H=stage.clientHeight;if(!W||!H)return;const top=Math.min(110,H*.22),bottom=H-(W<640?64:60),gap=W<640?6:8,mx=W<640?10:16,items=[];
  S.order.forEach(id=>{
    const L=LBL[id];if(!L)return;
    const shieldHidden=!showShield&&S.hasShield&&(id==='shield');
    if(!showLabels||shieldHidden){L.el.hidden=true;L.g.style.display='none';return;}
    tmp.copy(anchorW(id)).project(camera);
    if(tmp.z>1||Math.abs(tmp.x)>1.05||Math.abs(tmp.y)>1.05){L.el.hidden=true;L.g.style.display='none';return;}
    const ax=(tmp.x+1)/2*W,ay=(1-tmp.y)/2*H;
    if(L.side===null)L.side=ax<W/2?'L':'R';else if(L.side==='L'&&ax>W/2+50)L.side='R';else if(L.side==='R'&&ax<W/2-50)L.side='L';
    L.el.hidden=false;L.g.style.display='';items.push({ax,ay,L});
  });
  ['L','R'].forEach(side=>{
    const arr=items.filter(it=>it.L.side===side).sort((a,b)=>a.ay-b.ay);
    let y=top;arr.forEach(it=>{it.y=Math.max(it.ay-it.L.h,y);y=it.y+it.L.h+gap;});
    let lim=bottom;for(let i=arr.length-1;i>=0;i--){const it=arr[i];it.y=Math.min(it.y,lim-it.L.h);lim=it.y-gap;}
    arr.forEach(it=>{const L=it.L,x0=side==='L'?mx:W-mx-L.w,yl=it.y+L.h,ex=side==='L'?x0+L.w+14:x0-14;
      L.el.style.transform=`translate(${x0}px,${it.y}px)`;
      L.pl.setAttribute('points',side==='L'?`${it.ax},${it.ay} ${ex},${yl} ${x0},${yl}`:`${it.ax},${it.ay} ${ex},${yl} ${x0+L.w},${yl}`);
      L.c.setAttribute('cx',it.ax);L.c.setAttribute('cy',it.ay);});
  });
}

/* ================================================================== */
/*  HUD controls and picking                                           */
/* ================================================================== */
function setSpin(m){spinMult=m;$('sp0').setAttribute('aria-pressed',m===0);$('sp1').setAttribute('aria-pressed',m===1);$('sp10').setAttribute('aria-pressed',m===10);
  const rpm=S.rpm,v=omegaOf(rpm)*S.floorR;
  $('spinchip').innerHTML=m===0?`<b>Spin paused</b><br>Real station: ${rpm<1?rpm.toFixed(2):rpm.toFixed(1)} rpm`:`<b>Spin ${m===1?'real time':'×10'}</b><br>${(rpm*m).toFixed(rpm<1&&m===1?2:1)} rpm · floor moves ${Math.round(v)} m/s`;}
$('sp0').onclick=()=>setSpin(0);$('sp1').onclick=()=>{align=null;setSpin(1);};$('sp10').onclick=()=>{align=null;setSpin(10);};
function toggleCut(){showCut=!showCut;$('tCut').setAttribute('aria-pressed',showCut);if(!world)return;world.clipMats.forEach(m=>{m.clippingPlanes=showCut?m.userData.planes:null;m.needsUpdate=true;});world.capMeshes.forEach(c=>c.visible=showCut&&(world.shieldMeshes.indexOf(c)<0||showShield));}
function toggleShield(){if(!S.hasShield)return;showShield=!showShield;$('tShield').setAttribute('aria-pressed',showShield);if(!world)return;world.shieldMeshes.forEach(m=>m.visible=showShield&&(world.capMeshes.indexOf(m)<0||showCut));}
$('tCut').onclick=toggleCut;$('tShield').onclick=toggleShield;
$('tLbl').onclick=()=>{showLabels=!showLabels;$('tLbl').setAttribute('aria-pressed',showLabels);};
$('tReset').onclick=()=>select(null);
let ray,ptr,down=null,hoverPending=null;
function visibleDeep(o){while(o){if(!o.visible)return false;o=o.parent;}return true;}
function pick(cx,cy){
  const rect=canvas.getBoundingClientRect();ptr.set((cx-rect.left)/rect.width*2-1,-(cy-rect.top)/rect.height*2+1);
  ray.setFromCamera(ptr,camera);
  const hits=ray.intersectObjects(world.pickables.filter(visibleDeep),false);
  for(const h of hits){const m=h.object.material;if(showCut&&m.clippingPlanes&&m.clippingPlanes.length&&m.clippingPlanes.every(p=>p.distanceToPoint(h.point)<0))continue;if(m.transparent&&m.opacity<.5)continue;return h.object.userData.part;}
  return null;
}
canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
canvas.addEventListener('pointerup',e=>{if(!down||!world)return;const mv=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(mv<5){const p=pick(e.clientX,e.clientY);if(p)select(p);}});
canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||e.buttons)return;hoverPending=[e.clientX,e.clientY];});
canvas.addEventListener('pointerleave',()=>{hoverPending=null;if(state.hover){state.hover=null;paint();canvas.classList.remove('hot');}});

/* ================================================================== */
/*  Panel                                                              */
/* ================================================================== */
let sysCleanup=null;
function cleanupSys(){if(sysCleanup){sysCleanup();sysCleanup=null;}}
function switcher(){return `<nav class="sets" aria-label="Settlements">${SET_ORDER.map(k=>{const s=SETTLEMENTS[k];return `<button type="button" data-set="${k}" aria-current="${k===S.id}"><b>${s.name}</b><small>${s.year} · ${s.compare.size}</small></button>`;}).join('')}<button type="button" data-home><b>← Introduction</b><small>topics · all habitats</small></button></nav>`;}
function wireSwitcher(){panel.querySelectorAll('[data-home]').forEach(b=>b.addEventListener('click',()=>{location.hash='intro';}));panel.querySelectorAll('[data-set]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.set!==S.id)location.hash=b.dataset.set;}));}
function sources(){return `<div class="src"><p><b>Space Settlements</b> · a Worldmaking Project atlas by Damjan Jovanovic.</p><p>Sources: ${S.sources.map(([t,u])=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join(' · ')}.</p><p>${S.schematic}</p></div>`;}
function sysList(){const seen=[];S.order.forEach(id=>{const k=S.parts[id].sys;if(seen.indexOf(k)<0)seen.push(k);});return SYS_ORDER.filter(k=>seen.indexOf(k)>=0).map(k=>[k,S.order.find(id=>S.parts[id].sys===k)]);}
function compareTable(){
  const rows=[['Shape','shape'],['Size','size'],['Spin','spin'],['Gravity','gravity'],['People','people'],['Daylight','light'],['Shielding','shield']];
  return `<div class="cmpwrap"><table class="cmp"><thead><tr><th></th>${SET_ORDER.map(k=>`<th class="${k===S.id?'on':''}" scope="col">${SETTLEMENTS[k].short}</th>`).join('')}</tr></thead><tbody>${rows.map(([n,f])=>`<tr><th scope="row">${n}</th>${SET_ORDER.map(k=>`<td class="${k===S.id?'on':''}">${SETTLEMENTS[k].compare[f]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderOverview(){
  cleanupSys();openSys=null;
  panel.innerHTML=`${switcher()}
  <p class="eyebrow">${S.eyebrow}</p>
  <h1>${S.name}</h1>
  <p class="lede">${S.lede}</p>
  <p>Drag to orbit, scroll or pinch to zoom, and click any part of the settlement or any callout to open its sheet.</p>
  <dl class="figs">${S.figs.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  <h2>Systems</h2>
  <ul class="syslist">${sysList().map(([k,part],i)=>`<li><button type="button" data-part="${part}"><span class="ix">S${i+1}</span><span class="nm">${SYS[k].name}</span><small>${SYS[k].blurb}</small></button></li>`).join('')}</ul>
  <h2>Components</h2>
  <ul class="partlist">${S.order.map((id,i)=>`<li><button type="button" data-part="${id}"><span class="ix">${code(i)}</span><span class="nm">${S.parts[id].name}</span><small>${S.parts[id].blurb}</small></button></li>`).join('')}</ul>
  <h2>Compare the settlements</h2>
  ${compareTable()}
  ${sources()}`;
  wireSwitcher();
  panel.querySelectorAll('[data-part]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.part)));
  panel.scrollTop=0;
}
function renderPart(id){
  cleanupSys();
  const p=S.parts[id],i=S.order.indexOf(id),n=S.order.length,prev=S.order[(i+n-1)%n],next=S.order[(i+1)%n];
  const sl=sysList(),si=sl.findIndex(x=>x[0]===p.sys);
  panel.innerHTML=`${switcher()}
  <button class="back" type="button" id="back">← ${S.name} overview</button>
  <p class="eyebrow"><span class="code">${code(i)}</span>${p.kind}</p>
  <h1>${p.name}</h1>
  ${p.text.map(t=>`<p>${t}</p>`).join('')}
  <table class="specs"><tbody>${p.specs.map(([k,v])=>`<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
  <section class="sys"><p class="eyebrow">System S${si+1} · How it works</p><h2>${SYS[p.sys].name}</h2><div id="sysroot"></div></section>
  <nav class="pn" aria-label="Components"><button type="button" id="prev"><small>Previous · ${code((i+n-1)%n)}</small>${S.parts[prev].name}</button><button type="button" id="next"><small>Next · ${code((i+1)%n)}</small>${S.parts[next].name}</button></nav>
  ${sources()}`;
  wireSwitcher();
  $('back').onclick=()=>select(null);$('prev').onclick=()=>select(prev);$('next').onclick=()=>select(next);
  sysCleanup=MOUNT[p.sys]($('sysroot'),S.sys[p.sys]||{},S);
  panel.scrollTop=0;
}

/* ================================================================== */
/*  System diagrams                                                    */
/* ================================================================== */
const MOUNT={};
const marker=(id,col)=>`<marker id="${id}" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${col}"/></marker>`;

MOUNT.gravity=function(el,P,St){
  const lr0=Math.log10(St.floorR);
  el.innerHTML=`<p>Spin gravity is the push of the floor that keeps you moving in a circle. It grows with the square of the spin rate and in direct proportion to the distance from the axis. The chart is logarithmic on both axes, so each spin rate is a straight line, and all three settlements sit near 1 g.</p>
  <div class="ctrl"><label for="g-rpm">Spin rate</label><output id="g-rpm-o"></output><input id="g-rpm" type="range" min="0.2" max="6" step="0.01" value="${St.rpm}"></div>
  <div class="ctrl"><label for="g-r">Distance from axis</label><output id="g-r-o"></output><input id="g-r" type="range" min="1" max="4" step="0.005" value="${lr0}"></div>
  <svg id="g-svg" class="plot" viewBox="0 0 360 236" role="img" aria-label="Gravity against distance from the axis, with the three settlements marked"></svg>
  <dl class="readout" id="g-read"></dl><p class="note" id="g-note"></p>`;
  const q=id=>el.querySelector('#'+id);
  function draw(){
    const rpm=+q('g-rpm').value,rr=Math.pow(10,+q('g-r').value),w=omegaOf(rpm),g=w*w*rr/G0;
    q('g-rpm-o').textContent=rpm.toFixed(2)+' rpm';q('g-r-o').textContent=fmt(rr)+' m';
    const L=40,Rt=350,T=14,B=196,X=v=>L+(Rt-L)*(Math.log10(v)-1)/3,Y=v=>B-(B-T)*(Math.log10(Math.min(Math.max(v,.01),10))+2)/3;
    let s='';
    [.01,.1,1,10].forEach(v=>{s+=`<line class="grid" x1="${L}" x2="${Rt}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${L-5}" y="${Y(v)+3}" text-anchor="end">${v}</text>`;});
    [10,100,1000,10000].forEach(v=>{s+=`<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${B}"/><text class="tick" x="${X(v)}" y="${B+13}" text-anchor="middle">${fmt(v)}</text>`;});
    s+=`<text class="axis" x="${(L+Rt)/2}" y="${B+27}" text-anchor="middle">distance from axis (m)</text><text class="axis" x="9" y="${(T+B)/2}" transform="rotate(-90 9 ${(T+B)/2})" text-anchor="middle">gravity (g)</text>`;
    s+=`<rect class="band" x="${L}" y="${Y(1.05)}" width="${Rt-L}" height="${Y(.9)-Y(1.05)}"/><text class="bandt" x="${L+4}" y="${Y(1.05)-3}">≈1 g</text>`;
    const line=(om,cls)=>{const r0=Math.max(10,.01*G0/(om*om)),r1=Math.min(10000,10*G0/(om*om));return r1>r0?`<line class="${cls}" x1="${X(r0)}" y1="${Y(om*om*r0/G0)}" x2="${X(r1)}" y2="${Y(om*om*r1/G0)}"/>`:'';};
    [.5,1,2,4].forEach(k=>{const om=omegaOf(k),r1=Math.min(10000,10*G0/(om*om));s+=line(om,'ref')+`<text class="reft" x="${X(r1)-2}" y="${Y(om*om*r1/G0)+(r1<10000?11:-4)}" text-anchor="end">${k} rpm</text>`;});
    s+=line(w,'cur');
    SET_ORDER.forEach((k,i)=>{const st=SETTLEMENTS[k],gg=omegaOf(st.rpm)**2*st.floorR/G0,on=k===St.id,up=k==='island2'||k==='model1';s+=`<circle class="setpt${on?' on':''}" cx="${X(st.floorR)}" cy="${Y(gg)}" r="4.5"/><text class="setl${on?' on':''}" x="${X(st.floorR)}" y="${Y(gg)+(up?-9:16)}" text-anchor="middle">${st.short}</text>`;});
    s+=`<circle class="dot" cx="${X(rr)}" cy="${Y(g)}" r="5"/><text class="lbl2" x="${Math.min(X(rr)+8,Rt-50)}" y="${Math.max(Y(g)-8,T+10)}">${g<.1?g.toFixed(3):g.toFixed(2)} g</text>`;
    q('g-svg').innerHTML=s;
    q('g-read').innerHTML=ro('Gravity here',(g<.1?g.toFixed(3):g.toFixed(2))+' g')+ro('Floor speed',fmt(w*rr)+' m/s')+ro('Head vs. feet, 1.8 m tall',(180/rr).toFixed(2)+' % lighter')+ro('Sideways push, walking',(2*w*1.4/(w*w*rr)*100).toFixed(1)+' % of weight')+ro('Radius for 1 g at this spin',fmt(G0/(w*w))+' m')+ro('One lap takes',(60/rpm).toFixed(0)+' s');
    q('g-note').textContent=(rpm<=1.05?'At 1 rpm or less, head turns and walking produce almost no dizziness or sideways pull. ':rpm<=2.05?'Studies from the 1960s and 70s treated rates up to about 2 rpm as comfortable for nearly everyone. ':'Above about 2 rpm, early studies found people needed days to adapt and head movements caused motion sickness at first. ')+(P.note1||'');
  }
  el.querySelectorAll('input').forEach(i=>i.addEventListener('input',draw));draw();return null;
};

MOUNT.transit=function(el,P,St){
  const w=omegaOf(St.rpm),segs=P.segs,S0=[];let tot=0;segs.forEach(s=>{S0.push(tot);tot+=s.len;});
  const seg=s=>{let i=segs.length-1;while(i>0&&s<S0[i])i--;return i;};
  const rAt=s=>{const i=seg(s);return segs[i].r(Math.min(s-S0[i],segs[i].len));};
  el.innerHTML=`<p>${P.intro}</p>
  <svg id="t-svg" class="plot" viewBox="0 0 360 190" role="img" aria-label="Gravity along the trip from dock to floor"></svg>
  <div class="ctrl"><label for="t-s">Distance traveled</label><output id="t-o"></output><input id="t-s" type="range" min="0" max="${tot}" step="1" value="0"></div>
  <div class="btnrow"><button type="button" class="btn" id="t-play">${P.button}</button></div>
  <dl class="readout" id="t-read"></dl><p class="note">${P.note}</p>`;
  const q=id=>el.querySelector('#'+id);
  const L=30,Rt=350,T=40,B=160,X=s=>L+(Rt-L)*s/tot,gmax=Math.max(1,w*w*rAt(tot)/G0*1.05),Y=g=>B-(B-T)*g/gmax;
  let base='';
  [0,.25,.5,.75,1].forEach(v=>{base+=`<line class="grid" x1="${L}" x2="${Rt}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${L-5}" y="${Y(v)+3}" text-anchor="end">${v}</text>`;});
  segs.forEach((sg,i)=>{const a=X(S0[i]),b=X(S0[i]+sg.len),wd=b-a;base+=`<rect x="${a+1}" y="14" width="${Math.max(1,wd-2)}" height="12" fill="${sg.c}" opacity=".85"/>`;base+=`<text class="lblm" x="${wd>70?(a+b)/2:a}" y="${wd>70?9:(i%2?36:9)}" text-anchor="${wd>70?'middle':'start'}">${sg.n.toLowerCase()}</text>`;});
  let dp='';for(let k=0;k<=200;k++){const s=tot*k/200;dp+=(k?' L':'M')+X(s)+','+Y(w*w*rAt(s)/G0);}
  base+=`<path class="cur" d="${dp}"/><text class="axis" x="${(L+Rt)/2}" y="${B+16}" text-anchor="middle">distance traveled from the ship (m)</text><text class="axis" x="9" y="${(T+B)/2}" transform="rotate(-90 9 ${(T+B)/2})" text-anchor="middle">gravity (g)</text>`;
  function draw(){
    const s=+q('t-s').value,rr=rAt(s),g=w*w*rr/G0,sg=segs[seg(s)];
    q('t-o').textContent=fmt(s)+' m';
    q('t-svg').innerHTML=base+`<line class="mark" x1="${X(s)}" x2="${X(s)}" y1="${T-6}" y2="${B}"/><circle class="dot" cx="${X(s)}" cy="${Y(g)}" r="5"/><text class="lbl2" x="${Math.min(X(s)+7,Rt-40)}" y="${Math.max(Y(g)-9,T)}">${g.toFixed(2)} g</text>`;
    q('t-read').innerHTML=ro('You are in',sg.n)+ro('Distance from axis',fmt(rr)+' m')+ro('Gravity',g.toFixed(3)+' g')+ro('A 70 kg person weighs',(70*g).toFixed(1)+' kg')+ro('Sideways push at 5 m/s climb',sg.cor?(2*w*5/G0).toFixed(3)+' g':'none')+ro('Floor speed here',fmt(w*rr)+' m/s');
  }
  let raf=null,t0=0,s0=0;
  function step(ts){if(!t0)t0=ts;const s=Math.min(tot,s0+(ts-t0)/9000*tot);q('t-s').value=s;draw();if(s<tot)raf=requestAnimationFrame(step);else{raf=null;q('t-play').textContent='Again';}}
  q('t-play').onclick=()=>{if(raf){cancelAnimationFrame(raf);raf=null;q('t-play').textContent=P.button;return;}s0=+q('t-s').value>=tot?0:+q('t-s').value;t0=0;q('t-play').textContent='Pause';raf=requestAnimationFrame(step);};
  q('t-s').addEventListener('input',draw);draw();
  return ()=>{if(raf)cancelAnimationFrame(raf);};
};

function stepper(el,steps,allText){
  el.querySelectorAll('.lp-steps button').forEach(b=>b.addEventListener('click',()=>{
    const i=+b.dataset.i;el.querySelectorAll('.lp-steps button').forEach(x=>x.setAttribute('aria-pressed',x===b));
    el.querySelectorAll('.lp-rays .ray').forEach(p=>p.classList.toggle('dim',i>=0&&+p.dataset.s!==i));
    el.querySelector('.steptxt').textContent=i<0?allText:`${i+1}. ${steps[i]}`;}));
}
const stepButtons=n=>`<div class="btnrow lp-steps">${Array.from({length:n},(_,i)=>`<button type="button" class="btn" data-i="${i}" aria-pressed="false">${i+1}</button>`).join('')}<button type="button" class="btn" data-i="-1" aria-pressed="true">All</button></div><p class="steptxt">Pick a step to follow the light, or view the whole route at once.</p>`;
const LIGHT={};
LIGHT.torus=function(el){
  const steps=['Sunlight arrives from the side, square to the station’s axis.','The fixed primary mirror, angled at 45°, turns the light 90° and sends it down the axis.','The conical secondary mirrors around the hub throw the light outward toward the ring.','The light zigzags through the chevron louvres on the ring’s inner side. Particles cannot follow a zigzag.','Inside the ring, the light falls on the valley floor as daylight.'];
  el.innerHTML=`<p>Daylight reaches the valley by a three-mirror route, so no resident has a direct line of sight to space.</p>
  <svg class="plot" viewBox="0 0 360 200" role="img" aria-label="Elevation diagram of the light path through the mirrors"><defs>${marker('lpa','#FFD98A')}</defs>
    <line x1="180" y1="18" x2="180" y2="186" stroke="var(--line)" stroke-dasharray="2 4"/><text class="lblm" x="183" y="194">axis</text>
    <circle cx="340" cy="34" r="9" fill="#FFD98A"/><text class="lblm" x="340" y="56" text-anchor="middle">Sun</text>
    <line class="mirror" x1="155" y1="65" x2="205" y2="15"/><text class="lblm" x="146" y="28" text-anchor="end">primary</text>
    <line class="mirror" x1="162" y1="152" x2="174" y2="140"/><line class="mirror" x1="186" y1="140" x2="198" y2="152"/>
    <circle cx="180" cy="162" r="8" fill="var(--ink-2)" stroke="var(--ice)"/><text class="lblm" x="180" y="182" text-anchor="middle">hub</text><text class="lblm" x="210" y="134">secondary</text>
    <line x1="188" y1="162" x2="314" y2="146" stroke="var(--n2)" stroke-width="2"/><line x1="172" y1="162" x2="46" y2="146" stroke="var(--n2)" stroke-width="2"/>
    <circle cx="330" cy="146" r="18" fill="var(--ink-2)" stroke="var(--ice)"/><circle cx="30" cy="146" r="18" fill="var(--ink-2)" stroke="var(--ice)"/>
    <line x1="338" y1="130" x2="338" y2="162" stroke="var(--food)" stroke-width="2.5"/><line x1="22" y1="130" x2="22" y2="162" stroke="var(--food)" stroke-width="2.5"/>
    <path d="M312,136 l4,5 -4,5 4,5 -4,5" fill="none" stroke="var(--o2)" stroke-width="1.6"/><path d="M48,136 l-4,5 4,5 -4,5 4,5" fill="none" stroke="var(--o2)" stroke-width="1.6"/>
    <text class="lblm" x="330" y="178" text-anchor="middle">ring</text><text class="lblm" x="30" y="178" text-anchor="middle">ring</text>
    <g class="lp-rays"><path class="ray flow" data-s="0" d="M330,28 L194,28 M330,40 L182,40 M330,52 L170,52" marker-end="url(#lpa)"/><path class="ray flow" data-s="1" d="M192,28 L192,144 M168,52 L168,144"/><path class="ray flow" data-s="2" d="M192,146 L306,146 M168,146 L54,146" marker-end="url(#lpa)"/><path class="ray flow" data-s="3" d="M308,146 L316,146 M52,146 L44,146"/><path class="ray flow" data-s="4" d="M318,146 L336,146 M42,146 L24,146" marker-end="url(#lpa)"/></g>
  </svg>${stepButtons(5)}
  <p class="eyebrow">Chevron louvre, enlarged</p>
  <svg class="plot" viewBox="0 0 360 120" role="img" aria-label="Light reflects through the chevron louvres while a particle track is stopped">
    <g fill="none" stroke="var(--ice)" stroke-width="5" stroke-linecap="round"><path d="M150,18 L190,48 L150,78"/><path d="M190,18 L230,48 L190,78"/></g>
    <path class="ray flow" d="M40,30 L158,30 L176,48 L196,30 L222,48 L246,66 L330,66" marker-end="url(#lpa)"/>
    <path d="M40,96 L170,62" stroke="var(--heat)" stroke-width="2" fill="none"/><circle cx="170" cy="62" r="5" fill="none" stroke="var(--heat)"/>
    <text class="lblm" x="40" y="22">light: reflects through</text><text class="lblm" x="40" y="114">particle tracks: straight lines, absorbed by louvre mass</text><text class="lblm" x="300" y="58" text-anchor="middle">into the ring</text>
  </svg>`;
  stepper(el,steps,'All five legs together: Sun, primary mirror, secondary mirrors, chevron louvres, valley.');
};
LIGHT.bernal=function(el){
  const steps=['Sunlight arrives along the sphere’s axis.','A ring mirror around the pole turns the light inward and down.','The light passes through the windows near the pole, where the hull turns slowly.','It crosses the interior and lands on the equatorial valley on the far side.'];
  el.innerHTML=`<p>Island One brings light in at the poles and lets it fall across the sphere onto the inhabited equator.</p>
  <svg class="plot" viewBox="0 0 360 220" role="img" aria-label="Elevation diagram of light entering a Bernal sphere"><defs>${marker('lpb','#FFD98A')}</defs>
    <line x1="180" y1="6" x2="180" y2="214" stroke="var(--line)" stroke-dasharray="2 4"/><text class="lblm" x="184" y="212">axis</text>
    <circle cx="180" cy="125" r="60" fill="var(--ink-2)" stroke="var(--ice)" stroke-width="1.4"/>
    <path d="M125.6,99.6 A60,60 0 0 0 125.6,150.4" fill="none" stroke="var(--food)" stroke-width="4"/><path d="M234.4,99.6 A60,60 0 0 1 234.4,150.4" fill="none" stroke="var(--food)" stroke-width="4"/>
    <path d="M144.7,76.5 A60,60 0 0 1 166,66.7" fill="none" stroke="var(--o2)" stroke-width="4"/><path d="M215.3,76.5 A60,60 0 0 0 194,66.7" fill="none" stroke="var(--o2)" stroke-width="4"/>
    <line class="mirror" x1="93.5" y1="34.4" x2="106.5" y2="55.6"/><line class="mirror" x1="266.5" y1="34.4" x2="253.5" y2="55.6"/>
    <circle cx="180" cy="10" r="0" /><text class="lblm" x="100" y="16" text-anchor="middle">ring mirror</text><text class="lblm" x="300" y="70">polar window</text>
    <text class="lblm" x="250" y="130">equator valley</text>
    <g class="lp-rays">
      <path class="ray flow" data-s="0" d="M100,4 L100,42 M260,4 L260,42" marker-end="url(#lpb)"/>
      <path class="ray flow" data-s="1" d="M100,45 L146,69 M260,45 L214,69"/>
      <path class="ray flow" data-s="2" d="M146,69 L156,74 M214,69 L204,74"/>
      <path class="ray flow" data-s="3" d="M156,74 L232,113 M204,74 L128,113" marker-end="url(#lpb)"/>
    </g>
  </svg>${stepButtons(4)}`;
  stepper(el,steps,'All four legs: Sun, ring mirror, polar window, equatorial valley.');
};
LIGHT.oneill=function(el){
  el.innerHTML=`<p>The cylinder\u2019s axis points at the Sun, so sunlight runs along its length. A flat mirror above each window reflects it inside. In O\u2019Neill\u2019s words, as the mirrors slowly open in the morning, the Sun rises. Open the mirror to move from night to midday.</p>
  <div class="ctrl"><label for="lo-a">Mirror angle from the hull</label><output id="lo-ao"></output><input id="lo-a" type="range" min="0" max="90" step="1" value="26"></div>
  <svg id="lo-svg" class="plot" viewBox="0 0 360 230" role="img" aria-label="Side view of an O'Neill cylinder with a hinged mirror reflecting sunlight inside"></svg>
  <dl class="readout" id="lo-read"></dl>
  <p class="note">The light fraction is an illustrative ray count for this side view, not a figure from O\u2019Neill. He tied day length, weather, the seasons and the community\u2019s heat balance to one schedule of mirror angles, changed only slowly because plants adapt to new cycles less easily than people.</p>`;
  const q=id=>el.querySelector('#'+id);
  const X0=70,X1=330,TOP=110,BOT=170,LM=170,HX=X1;
  function rays(a,n){const out=[];const c=Math.cos(a),s=Math.sin(a),c2=Math.cos(2*a),s2=Math.sin(2*a);let hit=0;
    for(let i=1;i<=n;i++){const f=i/(n+1),P=[HX-f*LM*c,TOP-f*LM*s];let end=null,land=false;
      if(s2>1e-3){const t=(BOT-P[1])/s2;let ex=P[0]+t*c2;if(ex>=X0&&ex<=X1){end=[ex,BOT];land=true;}else{const xe=ex>X1?X1:X0,te=(xe-P[0])/c2;end=[xe,P[1]+te*s2];}}
      else{end=[P[0]+(c2>0?1:-1)*120,P[1]];}
      if(land)hit++;out.push({P,end,land});}
    return {out,hit,inter:s};}
  let best=0;for(let k=1;k<90;k++){const a=k*Math.PI/180,r=rays(a,60);best=Math.max(best,r.hit/60*r.inter);}
  function draw(){
    const deg=+q('lo-a').value,a=deg*Math.PI/180,R2=rays(a,6),Rf=rays(a,60),frac=deg<1?0:Rf.hit/60*Rf.inter/best;
    q('lo-ao').textContent=deg+'°';
    const tip=[HX-LM*Math.cos(a),TOP-LM*Math.sin(a)];
    let s=`<defs>${marker('lpo','#FFD98A')}</defs>`;
    s+=`<rect x="${X0}" y="${TOP}" width="${X1-X0}" height="${BOT-TOP}" fill="var(--ink-2)" stroke="var(--line)"/>`;
    s+=`<line x1="${X0}" y1="${TOP}" x2="${X1}" y2="${TOP}" stroke="var(--o2)" stroke-width="3"/><line x1="${X0}" y1="${BOT}" x2="${X1}" y2="${BOT}" stroke="var(--food)" stroke-width="4"/>`;
    s+=`<line x1="${X0-6}" y1="${(TOP+BOT)/2}" x2="${X1+12}" y2="${(TOP+BOT)/2}" stroke="var(--line)" stroke-dasharray="2 4"/>`;
    s+=`<circle cx="22" cy="40" r="10" fill="#FFD98A"/><text class="lblm" x="22" y="62" text-anchor="middle">Sun</text>`;
    s+=`<line class="mirror" x1="${HX}" y1="${TOP}" x2="${tip[0]}" y2="${tip[1]}"/><circle cx="${HX}" cy="${TOP}" r="3" fill="var(--ice)"/>`;
    s+=`<text class="lblm" x="${X0+4}" y="${TOP-4}">window</text><text class="lblm" x="${X0+4}" y="${BOT+12}">valley (land)</text><text class="lblm" x="${HX+4}" y="${TOP+12}">hinge</text><text class="lblm" x="${(HX+tip[0])/2-6}" y="${(TOP+tip[1])/2-6}" text-anchor="end">mirror</text>`;
    R2.out.forEach(r=>{s+=`<path class="ray flow" d="M30,${r.P[1]} L${r.P[0]},${r.P[1]}"/><path class="ray flow" d="M${r.P[0]},${r.P[1]} L${r.end[0]},${r.end[1]}" ${r.land?'marker-end="url(#lpo)"':''} style="opacity:${r.land?1:.35}"/>`;});
    q('lo-svg').innerHTML=s;
    const elev=Math.min(2*deg,180-2*deg),phase=frac<.04?'Night':elev<20?'Dawn or dusk':elev<60?'Morning or afternoon':'Midday';
    q('lo-read').innerHTML=ro('Sun\u2019s height in the sky',elev+'°')+ro('Light on the valleys',Math.round(frac*100)+' % of peak')+ro('Time of day',phase)+ro('Reflected ray tilt',(2*deg)+'° from the axis');
  }
  q('lo-a').addEventListener('input',draw);draw();
};
LIGHT.model1=function(el){
  const steps=['Sunlight arrives along the habitat’s axis.','Conical collar mirrors around each end cap turn the light inward, through a ring of windows at the cap’s rim.','Inside the shielded caps the light reflects between mirrors before reaching the living floor, so no straight path from space crosses the shield.','A long strip mirror beside the cylinder reflects light in through the window stripes onto the farm valleys.'];
  el.innerHTML=`<p>Redrawn after the sunlight-path diagram O’Neill published for Model One. Light reaches the shielded caps and the unshielded farms by different routes.</p>
  <svg class="plot" viewBox="0 0 360 240" role="img" aria-label="Elevation diagram of light paths in Model One"><defs>${marker('lpm','#FFD98A')}</defs>
    <line x1="180" y1="6" x2="180" y2="234" stroke="var(--line)" stroke-dasharray="2 4"/>
    <path d="M165,70 A15,15 0 0 1 195,70 L195,170 A15,15 0 0 1 165,170 Z" fill="var(--ink-2)" stroke="var(--ice)" stroke-width="1.3"/>
    <path d="M161,62 A19,19 0 0 1 199,62" fill="none" stroke="#b3a184" stroke-width="4"/><path d="M161,178 A19,19 0 0 0 199,178" fill="none" stroke="#b3a184" stroke-width="4"/>
    <line x1="165" y1="90" x2="165" y2="150" stroke="var(--food)" stroke-width="3"/><line x1="195" y1="90" x2="195" y2="150" stroke="var(--o2)" stroke-width="2"/>
    <line class="mirror" x1="166" y1="72" x2="140" y2="50"/><line class="mirror" x1="194" y1="72" x2="220" y2="50"/>
    <line class="mirror" x1="166" y1="168" x2="132" y2="146"/><line class="mirror" x1="194" y1="168" x2="228" y2="146"/>
    <line class="mirror" x1="240" y1="172" x2="290" y2="70"/>
    <text class="lblm" x="112" y="46" text-anchor="end">collar</text><text class="lblm" x="300" y="66">strip mirror</text><text class="lblm" x="150" y="122" text-anchor="end">farms</text><text class="lblm" x="210" y="122">window</text><text class="lblm" x="180" y="20" text-anchor="middle">shielded cap</text><text class="lblm" x="180" y="226" text-anchor="middle">shielded cap</text>
    <g class="lp-rays">
      <path class="ray flow" data-s="0" d="M148,4 L148,54 M212,4 L212,54 M136,4 L136,148 M262,4 L262,116" marker-end="url(#lpm)"/>
      <path class="ray flow" data-s="1" d="M148,57 L170,66 M212,57 L190,66 M136,151 L168,164"/>
      <path class="ray flow" data-s="2" d="M170,66 L188,74 L174,80 L186,86" marker-end="url(#lpm)"/>
      <path class="ray flow" data-s="3" d="M262,118 L197,118 L178,124" marker-end="url(#lpm)"/>
    </g>
  </svg>${stepButtons(4)}`;
  stepper(el,steps,'All four legs: Sun, collar mirrors, light baffles in the caps, strip mirror into the farm valleys.');
};
MOUNT.light=function(el,P){LIGHT[P.kind](el);return null;};

MOUNT.life=function(el,P){
  const POS={air:[180,34],people:[58,124],crops:[302,124],water:[112,212],animals:[248,212]};
  const E=[['people','air','CO₂','co2'],['air','people','O₂','o2'],['air','crops','CO₂','co2'],['crops','air','O₂, vapor','o2'],['crops','people','food','food'],['crops','animals','feed','food'],['animals','people','meat, eggs, fish','food'],['people','water','wastewater','waste'],['animals','water','manure','waste'],['water','crops','water, nutrients','water']];
  const rad=25;let svg='';
  E.forEach(e=>{const A=POS[e[0]],B=POS[e[1]],dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,cx=(A[0]+B[0])/2+nx*22,cy=(A[1]+B[1])/2+ny*22;
    const u=(px,py,qx,qy,k)=>{const l=Math.hypot(qx-px,qy-py);return [px+(qx-px)/l*k,py+(qy-py)/l*k];};
    const s=u(A[0],A[1],cx,cy,rad),t=u(B[0],B[1],cx,cy,rad+4),mx=.25*s[0]+.5*cx+.25*t[0],my=.25*s[1]+.5*cy+.25*t[1];
    svg+=`<path class="edge flow c-${e[3]}" data-a="${e[0]}" data-b="${e[1]}" d="M${s[0]},${s[1]} Q${cx},${cy} ${t[0]},${t[1]}" marker-end="url(#ls-${e[3]})"/><text class="elab t-${e[3]}" data-a="${e[0]}" data-b="${e[1]}" x="${mx+nx*6}" y="${my+ny*6+3}" text-anchor="middle">${e[2]}</text>`;});
  Object.entries(POS).forEach(([k,p])=>{const n=P.nodes[k];svg+=`<g class="node" data-n="${k}" tabindex="0" role="button" aria-label="${n[0]} ${n[1]}"><circle cx="${p[0]}" cy="${p[1]}" r="${rad}"/><text x="${p[0]}" y="${p[1]-1}">${n[0]}</text><text class="s" x="${p[0]}" y="${p[1]+10}">${n[1]}</text></g>`;});
  const mk=['o2','co2','food','water','waste'].map(c=>marker('ls-'+c,`var(--${c})`)).join('');
  const bar=rows=>rows.map(([n,v,c])=>`<span class="k-${c}" style="width:${v/101.3*100}%" title="${n} ${v} kPa">${v/101.3>.08?n+' '+v:''}</span>`).join('');
  el.innerHTML=`<p>${P.intro}</p>
  <svg class="plot" viewBox="0 0 360 246" role="img" aria-label="Flow diagram of the closed life support loop"><defs>${mk}</defs>${svg}</svg>
  <div class="legend"><span><i style="background:var(--o2)"></i>oxygen</span><span><i style="background:var(--co2)"></i>carbon dioxide</span><span><i style="background:var(--food)"></i>food</span><span><i style="background:var(--water)"></i>water</span><span><i style="background:var(--waste)"></i>waste</span></div>
  ${P.air?`<p class="eyebrow" style="margin-top:16px">Air pressure, kPa</p><div class="pbar"><div class="row"><span class="nm">${S.short}</span><div class="bar">${bar(P.air)}</div></div><div class="row"><span class="nm">Earth, sea level</span><div class="bar">${bar([['O₂',21.2,'o2'],['N₂',79.1,'n2'],['Ar',1.0,'ar']])}</div></div></div>`:''}
  <p class="note">${P.note}</p>`;
  let sel=null;const apply=()=>{el.querySelectorAll('.edge,.elab').forEach(p=>p.classList.toggle('dim',!!sel&&p.dataset.a!==sel&&p.dataset.b!==sel));el.querySelectorAll('.node').forEach(n=>n.classList.toggle('on',n.dataset.n===sel));};
  el.querySelectorAll('.node').forEach(n=>{const f=()=>{sel=sel===n.dataset.n?null:n.dataset.n;apply();};n.addEventListener('click',f);n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f();}});});
  return null;
};

MOUNT.shield=function(el,P){
  const torusMass=4.5*TORUS.sys.shield.area/1e9;
  el.innerHTML=`<p>${P.intro}</p>
  <div class="ctrl"><label for="s-a">Shield areal mass</label><output id="s-ao"></output><input id="s-a" type="range" min="0.5" max="10" step="0.1" value="4.5"></div>
  <svg id="s-svg" class="plot" viewBox="0 0 360 200" role="img" aria-label="Shield areal mass and total mass compared"></svg>
  <dl class="readout" id="s-read"></dl><p class="note">${P.note}</p>`;
  const q=id=>el.querySelector('#'+id);
  const big=P.area>1e8;
  function draw(){
    const a=+q('s-a').value,mass=a*P.area/1e9; // Mt
    q('s-ao').textContent=a.toFixed(1)+' t/m²';
    const L=110,Rt=330,X=v=>L+(Rt-L)*v/11;
    const bars=[['Earth’s air column',10.3,'var(--o2)'],[P.designLabel,P.design,'var(--muted)'],['Your shield',a,'var(--signal)']];
    let s='<text class="axis" x="0" y="10">Areal mass, t/m²</text>';
    bars.forEach(([n,v,c],i)=>{const y=20+i*24;s+=`<text class="lbl2" x="0" y="${y+12}">${n}</text><rect x="${L}" y="${y}" width="${X(v)-L}" height="16" fill="${c}"/><text class="lblm" x="${X(v)+4}" y="${y+12}">${v.toFixed(1)}</text>`;});
    const rows=[['This shield',mass,'var(--signal)'],['Torus shield (study)',torusMass,'var(--muted)']];if(P.hull)rows.push(['Torus aluminum hull',P.hull,'var(--ice)']);
    const M2=Math.max(...rows.map(r=>r[1])),X2=v=>L+(Rt-L)*v/(M2*1.08);
    s+='<text class="axis" x="0" y="112">Total mass, million tonnes</text>';
    rows.forEach(([n,v,c],i)=>{const y=122+i*22;s+=`<text class="lbl2" x="0" y="${y+11}">${n}</text><rect x="${L}" y="${y}" width="${Math.max(1.5,X2(v)-L)}" height="14" fill="${c}"/><text class="lblm" x="${Math.min(Math.max(L+1.5,X2(v))+4,Rt-6)}" y="${y+11}">${v<1?v.toFixed(2):fmt(v,v<100?1:0)}</text>`;});
    q('s-svg').innerHTML=s;
    q('s-read').innerHTML=ro('Slag thickness',(a/2.65).toFixed(2)+' m')+ro('Shield mass',(big?fmt(mass/1000,1)+' billion t':mass.toFixed(1)+' Mt'))+ro('Shielded area',big?fmt(P.area/1e6)+' km²':fmt(P.area/1e6,2)+' km²')+(P.pop?ro('Per resident',fmt(mass*1e6/P.pop)+' t'):ro('Times the torus shield',fmt(mass/torusMass)));
  }
  q('s-a').addEventListener('input',draw);draw();return null;
};

MOUNT.heat=function(el,P){
  const SIG=5.67e-8,EFF=.6,P0=P.P||100,T0=P.T||280;
  el.innerHTML=`<p>Every watt that enters the settlement as sunlight or electricity has to leave again as infrared radiation. Set a heat load and a radiator temperature.</p>
  <div class="chain"><span>Sunlight</span>+<span>Electricity</span>→<span>Absorbed inside</span>→<span>Waste heat</span>→<span>Radiators</span>→<span>Deep space, ≈3 K</span></div>
  <div class="ctrl"><label for="h-p">${P.label||'Heat to reject (example)'}</label><output id="h-po"></output><input id="h-p" type="range" min="10" max="500" step="1" value="${P0}"></div>
  <div class="ctrl"><label for="h-t">Radiator temperature</label><output id="h-to"></output><input id="h-t" type="range" min="250" max="450" step="1" value="${T0}"></div>
  <svg id="h-svg" class="plot" viewBox="0 0 360 190" role="img" aria-label="Radiator area against temperature"></svg>
  <dl class="readout" id="h-read"></dl>
  <p class="note">This follows the torus study’s method: a black-body output σT⁴ from one face at 60 percent effectiveness, plus half again in area for daytime peaks. At 280 K and about 130 MW it gives the study’s 6.3 × 10⁵ m², or 9.4 × 10⁵ m² with the margin.</p>`;
  const q=id=>el.querySelector('#'+id);
  function draw(){
    const Pw=+q('h-p').value*1e6,T=+q('h-t').value,flux=EFF*SIG*Math.pow(T,4),area=Pw/flux;
    q('h-po').textContent=fmt(Pw/1e6)+' MW';q('h-to').textContent=T+' K ('+(T-273)+' °C)';
    const L=40,Rt=350,Tp=14,B=160,amax=Pw/(EFF*SIG*Math.pow(250,4))/1e4,nice=Math.pow(10,Math.floor(Math.log10(amax))),ymax=Math.ceil(amax/nice)*nice;
    const X=t=>L+(Rt-L)*(t-250)/200,Y=a=>B-(B-Tp)*a/ymax;let s='';
    for(let k=0;k<=4;k++){const v=ymax*k/4;s+=`<line class="grid" x1="${L}" x2="${Rt}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${L-5}" y="${Y(v)+3}" text-anchor="end">${v>=10?fmt(v):v.toFixed(1)}</text>`;}
    [250,300,350,400,450].forEach(t=>{s+=`<text class="tick" x="${X(t)}" y="${B+13}" text-anchor="middle">${t}</text>`;});
    let dp='';for(let t=250;t<=450;t+=4){dp+=(t===250?'M':' L')+X(t)+','+Y(Pw/(EFF*SIG*Math.pow(t,4))/1e4);}
    s+=`<path class="cur" d="${dp}"/><circle class="dot" cx="${X(T)}" cy="${Y(area/1e4)}" r="5"/><text class="axis" x="${(L+Rt)/2}" y="${B+27}" text-anchor="middle">radiator temperature (K)</text><text class="axis" x="9" y="${(Tp+B)/2}" transform="rotate(-90 9 ${(Tp+B)/2})" text-anchor="middle">area (hectares)</text>`;
    q('h-svg').innerHTML=s;
    q('h-read').innerHTML=ro('Output per m²',fmt(flux)+' W')+ro('Area needed',fmt(area/1e4,1)+' ha')+ro('With 50 % margin',fmt(area*1.5/1e4,1)+' ha')+ro('Mass at 2.5 kg/m²',fmt(area*1.5*2.5/1000)+' t');
  }
  el.querySelectorAll('input').forEach(i=>i.addEventListener('input',draw));draw();return null;
};

MOUNT.pair=function(el){
  el.innerHTML=`<p>A spinning cylinder is a gyroscope. Compare one cylinder with a counter-rotating pair when the settlement has to turn to keep facing the Sun.</p>
  <div class="btnrow"><button type="button" class="btn" id="pr-1" aria-pressed="false">One cylinder</button><button type="button" class="btn" id="pr-2" aria-pressed="true">Counter-rotating pair</button></div>
  <svg id="pr-svg" class="plot" viewBox="0 0 360 200" role="img" aria-label="Angular momentum of one cylinder compared with a counter-rotating pair"></svg>
  <dl class="readout" id="pr-read"></dl>
  <p class="note">Island Three travels around the Sun with the Earth and Moon, so to keep its axis aimed at the Sun it must swing through a full turn each year, about one degree a day. A lone cylinder would need that small but steady force from somewhere. In the pair, each cylinder supplies it for the other through the frame, and the turning costs no fuel.</p>`;
  const q=id=>el.querySelector('#'+id);let pair=true;
  function cyl(cx,sign,lab){
    const y0=60,y1=150;let s=`<rect x="${cx-26}" y="${y0}" width="52" height="${y1-y0}" rx="6" fill="var(--ink-2)" stroke="var(--ice)"/>`;
    s+=`<ellipse cx="${cx}" cy="${y0}" rx="26" ry="8" fill="var(--ink-2)" stroke="var(--ice)"/>`;
    s+=`<path class="flow${sign<0?' flow-rev':''}" d="M${cx-32},${y0+46} A32,10 0 1 0 ${cx+32},${y0+46}" stroke="var(--signal)" stroke-width="2" fill="none" marker-end="url(#pra)"/>`;
    s+=`<line x1="${cx}" y1="${y0-8}" x2="${cx}" y2="${sign>0?y0-46:y0-46}" stroke="var(--o2)" stroke-width="3" marker-end="url(#prL)" transform="${sign<0?`rotate(180 ${cx} ${(y0+y1)/2})`:''}"/>`;
    s+=`<text class="lblm" x="${cx}" y="${y1+16}" text-anchor="middle">${lab}</text>`;return s;}
  function draw(){
    q('pr-1').setAttribute('aria-pressed',!pair);q('pr-2').setAttribute('aria-pressed',pair);
    let s=`<defs>${marker('pra','var(--signal)')}${marker('prL','var(--o2)')}</defs>`;
    if(pair){s+=cyl(120,1,'spins one way')+cyl(240,-1,'spins the other way');s+=`<line x1="146" y1="64" x2="214" y2="64" stroke="var(--muted)" stroke-width="3"/><line x1="146" y1="146" x2="214" y2="146" stroke="var(--muted)" stroke-width="3"/><text class="lblm" x="180" y="56" text-anchor="middle">frame</text>`;}
    else s+=cyl(180,1,'single cylinder');
    s+=`<text class="lblm" x="8" y="14">blue arrows: angular momentum</text>`;
    q('pr-svg').innerHTML=s;
    q('pr-read').innerHTML=ro('Net angular momentum',pair?'≈0':'Large')+ro('Turning ≈1° a day',pair?'Each cylinder pushes the other':'Needs an outside force')+ro('Spin directions',pair?'Opposite':'One')+ro('Gyroscopic resistance',pair?'Cancels':'Full');
  }
  q('pr-1').onclick=()=>{pair=false;draw();};q('pr-2').onclick=()=>{pair=true;draw();};draw();return null;
};

/* ================================================================== */
/*  Guided tours: passages from the sources along a camera path        */
/* ================================================================== */
const SP5='SP-413, chapter 5, “A Tour of the Colony”',HFL='The High Frontier, a colonist’s letter',HF3='The High Frontier, on Island Three';
TORUS.tour=[
  ['overview','Arrival','“The colony appears first as a mere point of light that gradually exceeds the other stars in brightness, and then it forms into a narrow band of sunlight reflected from the radiation shield.”',SP5],
  ['shield','The tire','“The rough-looking outer ‘tire’ is really a radiation shield built of rubble from the Moon. It protects the colony’s inhabitants from cosmic rays.”',SP5],
  ['mirror','The mirror','“The burnished disc that hangs suspended above the wheel” reflects sunlight to other mirrors, which direct it through mirrors “arranged in a chevron form to block cosmic rays.”',SP5],
  ['docking','The North Pole','“Local custom has named the docking area the North Pole.” On arrival “there is an unexpected lack of officials and there are no landing formalities.”',SP5],
  ['hub','Lunch break','“A few workers on their lunch break can be seen cavorting in the almost zero-g of the central hub playing an unusual type of ballgame, invented by earlier construction workers.”',SP5],
  ['spokes','The elevator','The visitor begins “the 830-m trip out to the torus. As the elevator moves and the sense of ‘gravity’ begins, you realize that ‘out’ is really ‘down.’”',SP5],
  ['habitat','A residential area','“A city which does not dwarf its inhabitants,” with “the broad expanse of yellow sunlight streaming down from far overhead.”',SP5],
  ['agriculture','The farms','“Tiers of fields and ponds and cascading water.” The visitor marvels “that so fruitful a garden spot is actually in barren space.”',SP5],
  ['industry','Production','“To one side of the fabrication sphere is a 200 MW solar power plant and furnace used in fabrication.”',SP5],
  ['overview','Night','“Finally, you drift off in sleep, dreaming of yourself as an early American pioneer, clearing a small stand of trees.”',SP5]
];
BERNAL.tour=[
  ['overview','Bernal Alpha','“We live in Bernal Alpha, a sphere about five hundred meters in diameter, with a circumference inside, at its ‘equator’ of nearly a mile.”',HFL],
  ['valley','The ring pathway','“We have track races and bicycle races that use the ring pathway. That path wanders all the way round, generally following the equator, and near it is our little river.”',HFL],
  ['mirrors','Midmorning light','“Our sunshine comes in at an angle near 45°, rather like midmorning or midafternoon on Earth.”',HFL],
  ['valley','Climate','“Alpha has a Hawaiian climate, so we lead an indoor-outdoor life all year.”',HFL],
  ['docking','The axis','“Quite often Jenny and I climb the path to the ‘North Pole’ and pedal out along the zero-gravity axis of the sphere for half an hour or so.”',HFL],
  ['windows','Low gravity near the poles','“Ballet in 1/10 gravity is beautiful to watch: dreamlike, and very graceful.”',HFL]
];
ISLAND2.tour=[
  ['overview','Moving up','“After Island One, ‘Two’ seemed really big.”',HFL],
  ['valley','No dizziness','“Almost no one feels any dizziness in a habitat as big as Island Two.”',HFL],
  ['valley','Pines and firs','“‘Two’ is not so warm, and runs with a climate that’s right for pine trees and firs.”',HFL],
  ['valley','The lake','Island Two’s lake “may have beaches lapped by waves perhaps even large enough for surfing.”','The High Frontier'],
  ['industry','Industry outside','Heavy industry sits outside the sphere, at least a few hundred meters away, in zero gravity.','The High Frontier']
];
ONEILL.tour=[
  ['overview','Island Three','A coupled pair of cylinders, each about 6.4 km across and 32 km long, with three valleys and three windows apiece.',HF3],
  ['land','Villages and forests','Some settlers “may choose to arrange their land area in small villages, with single-family homes, the villages being separated by forests.”',HF3],
  ['mirrors','Sunrise','“As the mirrors slowly open in the morning, the Sun will rise, but will move in the sky only as fast as it does on Earth.”',HF3],
  ['caps','The mountains','A hiker climbing the end-cap mountains weighs less with every step “and can climb in bounding strides.”',HF3],
  ['land','Evening flights','“We can imagine elderly ladies and gentlemen taking their evening constitutionals by gently pedaling their aircraft.”',HF3],
  ['windows','The view','Through a living-room window set at an angle, stars drift “majestically across the field of view as Island Three rotates in its unvarying two-minute cycle.”',HF3],
  ['pair','The other cylinder','Passengers between the cylinders arrive “and find themselves in what is literally another world.”',HF3]
];
let tourI=-1;
const tourbox=$('tourbox');
function tourStop(i){
  const T=S.tour;if(!T||!world)return;tourI=Math.max(0,Math.min(T.length-1,i));const st=T[tourI];
  const id=st[0]==='overview'?null:st[0];state.sel=id;paint();updateLabelClasses();flyTo(viewW(st[0]));if(id&&S.onSelect)S.onSelect(id,API);
  tourbox.hidden=false;
  tourbox.innerHTML=`<p class="eyebrow">Tour · ${tourI+1} of ${T.length} · ${st[3]}</p><h3>${st[1]}</h3><p class="tq">${st[2]}</p>
    <div class="btnrow"><button type="button" class="btn" id="tPrev" ${tourI===0?'disabled':''}>Back</button><button type="button" class="btn" id="tNext">${tourI===T.length-1?'Finish':'Next'}</button><button type="button" class="btn" id="tEnd">Close</button>${id?`<button type="button" class="btn" id="tOpen">Open this part</button>`:''}</div>`;
  $('tPrev').onclick=()=>tourStop(tourI-1);$('tNext').onclick=()=>{if(tourI===T.length-1)endTour();else tourStop(tourI+1);};$('tEnd').onclick=endTour;
  if(id)$('tOpen').onclick=()=>{endTour();select(id);};
}
function endTour(){tourI=-1;tourbox.hidden=true;$('tTour').setAttribute('aria-pressed','false');}
$('tTour').onclick=()=>{if(tourI>=0)endTour();else{$('tTour').setAttribute('aria-pressed','true');tourStop(0);}};

/* ================================================================== */
/*  Loop and start                                                     */
/* ================================================================== */
function resize(){if(!renderer)return;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();measure();}
let last=performance.now();
function frame(now){
  const raw=Math.max(0,(now-last)/1000),dt=Math.min(.05,raw);last=now;
  if(world){
    world.rotors.forEach(r=>{if(!(align&&align.obj===r.obj))r.obj.rotation.y+=r.sign*omegaOf(S.rpm)*spinMult*dt;});
    if(align){align.t+=raw/align.dur;const k=ease(Math.min(1,align.t));align.obj.rotation.y=align.a0+(align.a1-align.a0)*k;if(align.t>=1)align=null;}
  }
  if(fly){fly.t+=raw/fly.dur;const k=ease(Math.min(1,fly.t));camera.position.lerpVectors(fly.c0,fly.c1,k);controls.target.lerpVectors(fly.t0,fly.t1,k);if(fly.t>=1)fly=null;}
  controls.update();
  if(hoverPending&&world){const p=pick(hoverPending[0],hoverPending[1]);hoverPending=null;if(p!==state.hover){state.hover=p;paint();}canvas.classList.toggle('hot',!!p);}
  if(htmlEl.dataset.mode==='app'){renderer.render(scene,camera);layoutLabels();}
  requestAnimationFrame(frame);
}
/* ================================================================== */
/*  Topic pages: economy, energy, mass driver, construction, design    */
/* ================================================================== */
const PAGES={};
const NS='http://www.w3.org/2000/svg';
const yrCal=y=>1975+y;

/* ---------- Economy (SP-413 Table 6-12, Table 6-8, Fig 6-2) ---------- */
const CF=[-1.9,-2.8,-5.1,-5.8,-6.9,-6.2,-5.4,-8.5,-12.9,-18.3,-19.9,-17.8,-19.1,-20.4,
  -24.7,-22.6,-20.4,-18.4,-20.2,-21.8,-20.2,-14.3,
  -10.2,-12.6,-14.9,-11.6,-2.1,4.8,18.6,29.7,
  36.5,48.7,57.0,70.4,79.2,89.8,106.2,117.2,128.9,142.7,157.5,173.0,191.3,212.5,231.3];
const SSPS_NEW={15:1,16:1,17:1,18:1,19:1,20:2,21:2,22:3,23:3,24:4,25:7,26:8,27:8,28:9,29:9,30:9,31:10,32:10,33:11,34:11,35:12,36:13,37:13,38:14,39:15,40:15,41:16,42:17,43:18,44:19,45:20};
const SSPS_USE={16:1,17:2,18:3,19:4,20:5,21:7,22:9,23:12,24:15,25:19,26:26,27:34,28:42,29:51,30:60,31:69,32:79,33:89,34:100,35:111,36:123,37:136,38:149,39:163,40:178,41:193,42:209,43:226,44:244,45:263};
const MILES=[[5,'Shuttle and heavy-lift vehicle'],[10,'Lunar processing equipment'],[15,'First power satellite'],[20,'Colonists arrive'],[22,'Colony complete'],[28,'Annual payback']];
PAGES.economy={init(){
  const L=46,R=748,T=16,B=264,N=45,bw=(R-L)/N,ymin=-40,ymax=240,Y=v=>B-(B-T)*(v-ymin)/(ymax-ymin),X=y=>L+(y-1)*bw;
  function bars(){
    const sel=+$('ec-year').value;let s='';
    for(let v=-40;v<=240;v+=40)s+=`<line class="${v===0?'zero':'grid'}" x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${L-6}" y="${Y(v)+3}" text-anchor="end">${v}</text>`;
    MILES.forEach(([y,t],i)=>{const x=X(y)+bw/2;s+=`<line class="ms" x1="${x}" x2="${x}" y1="${T}" y2="${B}"/><text class="mst" x="${x+3}" y="${T+10+(i%3)*11}">${t}</text>`;});
    CF.forEach((v,i)=>{const y=i+1,x=X(y)+1,top=Math.min(Y(v),Y(0)),h=Math.abs(Y(v)-Y(0));s+=`<rect class="bar ${v<0?'neg':'pos'}${y===sel?' sel':''}" data-y="${y}" x="${x}" y="${top}" width="${bw-2}" height="${Math.max(1,h)}"/>`;});
    [1,10,20,30,40,45].forEach(y=>{s+=`<text class="tick" x="${X(y)+bw/2}" y="${B+14}" text-anchor="middle">${y}</text>`;});
    s+=`<text class="lab" x="${(L+R)/2}" y="${B+30}" text-anchor="middle">program year (year 1 = 1976)</text>`;
    $('ec-bars').innerHTML=s;
    $('ec-bars').querySelectorAll('.bar').forEach(b=>b.addEventListener('click',()=>{$('ec-year').value=b.dataset.y;draw();}));
  }
  function cum(){
    const r=+$('ec-rate').value/100;let a=0,b=0;const u=[],dsc=[];
    CF.forEach((v,i)=>{a+=v;b+=v/Math.pow(1+r,i+1);u.push(a);dsc.push(b);});
    const lo=-400,hi=1800,YY=v=>264-(264-16)*(v-lo)/(hi-lo);let s='';
    for(let v=-400;v<=1800;v+=400)s+=`<line class="${v===0?'zero':'grid'}" x1="${L}" x2="${R}" y1="${YY(v)}" y2="${YY(v)}"/><text class="tick" x="${L-6}" y="${YY(v)+3}" text-anchor="end">${v}</text>`;
    const path=arr=>arr.map((v,i)=>(i?'L':'M')+(X(i+1)+bw/2)+','+YY(v)).join(' ');
    s+=`<path class="ln1" d="${path(u)}"/><path class="ln2" d="${path(dsc)}"/>`;
    [1,10,20,30,40,45].forEach(y=>{s+=`<text class="tick" x="${X(y)+bw/2}" y="${264+14}" text-anchor="middle">${y}</text>`;});
    s+=`<text class="lab2" x="${R-6}" y="${YY(u[44])+14}" text-anchor="end">undiscounted</text><text class="lab2" x="${R-6}" y="${YY(dsc[44])-8}" text-anchor="end" fill="var(--signal)">discounted at ${(r*100).toFixed(1)} %</text>`;
    $('ec-cum').innerHTML=s;
    return {u,dsc,r};
  }
  function draw(){
    const y=+$('ec-year').value;$('ec-yo').textContent=`${y} (${yrCal(y)})`;$('ec-ro').textContent=$('ec-rate').value+' %';
    bars();const c=cum();
    const pay=c.u.findIndex((v,i)=>v>=0&&i>20)+1,dpay=c.dsc.findIndex((v,i)=>v>=0&&i>20)+1,minU=Math.min(...c.u);
    $('ec-read').innerHTML=`<p class="eyebrow">Year ${y} · ${yrCal(y)}</p><dl class="readout one" style="margin:6px 0 0">${ro('Cash flow this year',(CF[y-1]>0?'+':'')+CF[y-1].toFixed(1)+' B$')+ro('Running total',c.u[y-1].toFixed(0)+' B$')+ro('Power satellites in use',SSPS_USE[y]||0)+ro('Deepest point, undiscounted',minU.toFixed(0)+' B$, year '+(c.u.indexOf(minU)+1))+ro('Running total turns positive',pay>0?'year '+pay+' ('+yrCal(pay)+')':'after year 45')+ro('Discounted at '+(c.r*100).toFixed(1)+' %',dpay>0?'positive by year '+dpay:'still negative at year 45 ('+c.dsc[44].toFixed(0)+' B$)')}</dl>`;
  }
  $('ec-year').addEventListener('input',draw);$('ec-rate').addEventListener('input',draw);draw();
  const parts=[['Research',1.6,'#55667F'],['Development',28.5,'#A9CFE6'],['Production',14.6,'#93C76D'],['Transportation',114.3,'#F2A541'],['Overhead (20 %)',31.8,'#8C8FA0']];
  $('ec-break').innerHTML=`<div class="pbar"><div class="bar" style="height:26px">${parts.map(([n,v,c])=>`<span style="width:${v/190.8*100}%;background:${c}" title="${n} $${v}B"></span>`).join('')}</div></div><div class="legend">${parts.map(([n,v,c])=>`<span><i style="background:${c}"></i>${n} ${v}</span>`).join('')}</div>`;
}};

/* ---------- Energy ---------- */
PAGES.energy={init(){
  const D={
    pv:{name:'Photovoltaic',stages:[['Sunlight','1.4 kW/m²','at geosynchronous orbit'],['Silicon cells','2× concentration','mirrors on the array'],['Microwave beam','8 GW sent','10 cm wavelength'],['Receiving antenna','65 % dc to dc','beam and conversion'],['Power grid','5 GW','delivered']],
      facts:[['Delivered','5 GW'],['Specific mass','3.6 kg/kW (≈18,000 t)'],['Crew','fewer than 6'],['Source','Arthur D. Little / Glaser']]},
    th:{name:'Turbogenerator',stages:[['Sunlight','1.4 kW/m²','at geosynchronous orbit'],['10,000 facets','2,000× concentration','into a cavity absorber'],['Helium Brayton cycle','turbogenerators','radiator at 550 K'],['Microwave beam','3 GHz, 67 %','10 cm wavelength'],['Receiving antenna','85 % to electricity','10 GW delivered']],
      facts:[['Delivered','10 GW'],['Specific mass','6.5 kg/kW (≈65,000 t)'],['Crew','fewer than 50'],['Source','Boeing / Woodcock']]}
  };
  let k='th';
  function chain(){
    const d=D[k];let s=`<defs>${marker('en-a','#FFD98A')}</defs>`;const n=d.stages.length,w=178,g=(1100-24-n*w)/(n-1);
    d.stages.forEach((st,i)=>{const x=12+i*(w+g);s+=`<rect class="box" x="${x}" y="70" width="${w}" height="92"/><text class="boxt" x="${x+10}" y="96">${st[0]}</text><text class="eff" x="${x+10}" y="120">${st[1]}</text><text class="boxs" x="${x+10}" y="142">${st[2]}</text>`;
      if(i<n-1)s+=`<path class="arrow flow" d="M${x+w+4},116 L${x+w+g-6},116" marker-end="url(#en-a)"/>`;});
    s+=`<circle cx="40" cy="34" r="14" fill="#FFD98A"/><text class="lab" x="62" y="38">${d.name} design · stages after SP-413 chapter 4</text>`;
    s+=`<text class="lab" x="12" y="200">Earth’s shadow covers a geosynchronous satellite only briefly around the equinoxes, so output is nearly continuous.</text>`;
    $('en-chain').innerHTML=s;
    $('en-facts').innerHTML=d.facts.map(([a,b])=>`<div class="pbox"><p class="eyebrow">${a}</p><p style="font:600 20px/1.2 var(--display)">${b}</p></div>`).join('');
    $('en-pv').setAttribute('aria-pressed',k==='pv');$('en-th').setAttribute('aria-pressed',k==='th');
  }
  $('en-pv').onclick=()=>{k='pv';chain();};$('en-th').onclick=()=>{k='th';chain();};chain();
  // capacity vs demand
  {const L=50,R=748,T=16,B=250,X=y=>L+(R-L)*(y-15)/30,ymax=3000,Y=v=>B-(B-T)*v/ymax;let s='';
    for(let v=0;v<=3000;v+=500)s+=`<line class="grid" x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${L-6}" y="${Y(v)+3}" text-anchor="end">${fmt(v)}</text>`;
    let cap='',dem='',us='';for(let y=15;y<=45;y++){const c=(SSPS_USE[y]||0)*10,dm=224*Math.pow(1.05,y);cap+=(y>15?'L':'M')+X(y)+','+Y(c);us+=(y>15?'L':'M')+X(y)+','+Y(c*2/3);dem+=(y>15?'L':'M')+X(y)+','+Y(dm);}
    s+=`<path class="ln2" d="${cap}"/><path class="ln3" d="${us}"/><path class="ln1" d="${dem}"/>`;
    [15,20,25,30,35,40,45].forEach(y=>{s+=`<text class="tick" x="${X(y)}" y="${B+14}" text-anchor="middle">${y} · ${yrCal(y)}</text>`;});
    s+=`<text class="lab2" x="${X(45)-4}" y="${Y(2630)-8}" text-anchor="end" fill="var(--signal)">satellite capacity, 263 × 10 GW</text><text class="lab2" x="${X(45)-4}" y="${Y(224*Math.pow(1.05,45))+16}" text-anchor="end">US demand, +5 %/yr</text><text class="lab2" x="${X(38)}" y="${Y(1100)+18}" fill="var(--o2)">power kept in the US (⅔)</text>`;
    $('en-cap').innerHTML=s;}
  // beam densities, log scale
  {const rows=[['Beam center, peak',10,100,'var(--signal)'],['US exposure standard (1970s)',10,10,'var(--ice)'],['Microwave oven limit at 5 cm',1,1,'var(--ice)'],['Beam at 10–15 km',.01,.01,'var(--o2)'],['Strictest Eastern European limit',.01,.01,'var(--muted)']];
    const L=12,R=330,X=v=>L+(R-L)*(Math.log10(v)+3)/5;let s='';
    [-3,-2,-1,0,1,2].forEach(e=>{const v=Math.pow(10,e);s+=`<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="14" y2="200"/><text class="tick" x="${X(v)}" y="214" text-anchor="middle">${v>=1?v:v.toString()}</text>`;});
    rows.forEach(([n,a,b,c],i)=>{const y=26+i*36;s+=`<text class="lab2" x="${L}" y="${y}">${n}</text>`+(a===b?`<circle cx="${X(a)}" cy="${y+12}" r="6" fill="${c}"/>`:`<rect x="${X(a)}" y="${y+6}" width="${X(b)-X(a)}" height="12" fill="${c}"/>`);});
    s+=`<text class="lab" x="${(L+R)/2}" y="236" text-anchor="middle">mW/cm², logarithmic</text>`;
    $('en-beam').innerHTML=s;}
}};

/* ---------- Mass driver ---------- */
PAGES.massdriver={raf:0,init(){
  const A=288,V=2400,LC=10000,LF=1000,LD=1000,LB=3000; // m/s², m/s, m
  const xs=d=>{ // map real distance along launch side to px, compressed: coarse 0..10 km -> 30..460, fine 460..560, drift 560..640
    if(d<=LC)return 30+430*d/LC; if(d<=LC+LF)return 460+100*(d-LC)/LF; return 560+80*Math.min(1,(d-LC-LF)/LD);};
  let buckets=[],t=0,last=0,spawn=0,flyers=[];
  function frame(ts){
    if(!last)last=ts;const dt=Math.min(.05,(ts-last)/1000);last=ts;t+=dt;
    const rate=+$('md-r').value;spawn+=dt*rate;
    while(spawn>=1){spawn-=1;buckets.push({t0:t});}
    let s=`<rect x="0" y="100" width="760" height="60" class="moon"/><line class="rail" x1="20" y1="100" x2="700" y2="100"/><line class="rail" x1="20" y1="134" x2="700" y2="134"/>`;
    s+=`<line class="track" x1="30" y1="100" x2="460" y2="100"/><text class="seg" x="245" y="90" text-anchor="middle">coarse acceleration · 10 km at 288 m/s² (≈29 g)</text>`;
    s+=`<line class="track" x1="460" y1="100" x2="560" y2="100" stroke-dasharray="6 3"/><text class="seg" x="510" y="74" text-anchor="middle">fine · 1 km</text>`;
    s+=`<line class="track" x1="560" y1="100" x2="640" y2="100" stroke-dasharray="2 3"/><text class="seg" x="600" y="90" text-anchor="middle">drift, measure</text>`;
    s+=`<text class="seg" x="748" y="22" text-anchor="end">release ↗ 2.4 km/s toward L2</text><text class="seg" x="250" y="152" text-anchor="middle">empty buckets brake over 3 km at more than 100 g and return on a parallel track</text>`;
    buckets=buckets.filter(b=>{const tau=t-b.t0,tc=V/A;let d;if(tau<tc)d=.5*A*tau*tau;else d=LC+V*(tau-tc);
      if(d>LC+LF+LD){flyers.push({t0:t,x:640});return false;}
      const x=xs(d);s+=`<rect class="bucket" x="${x-5}" y="91" width="10" height="9"/><rect class="pay" x="${x-3}" y="87" width="6" height="5"/>`;return true;});
    flyers=flyers.filter(f=>{const tau=t-f.t0,x=640+tau*140,y=87-tau*90;if(y<-10)return false;s+=`<rect class="pay" x="${x}" y="${y}" width="6" height="5"/>`;return true;});
    const ret=(t*60)%600;for(let i=0;i<6;i++){const x=640-((ret+i*100)%600);s+=`<rect class="bucket2" x="${x}" y="129" width="10" height="9"/>`;}
    $('md-track').innerHTML=s;
    PAGES.massdriver.raf=requestAnimationFrame(frame);
  }
  function read(){
    const m=+$('md-m').value,r=+$('md-r').value,du=+$('md-d').value/100;
    $('md-mo').textContent=m+' kg';$('md-ro').textContent=r+' per s';$('md-do').textContent=Math.round(du*100)+' %';
    const kgps=m*r,mt=kgps*du*3.156e7/1e9,yrs=10/mt,ke=kgps*V*V/2/1e6;
    $('md-read').innerHTML=ro('Throughput',mt.toFixed(2)+' Mt per year')+ro('10 Mt for the colony',yrs.toFixed(1)+' years')+ro('Kinetic power in the payloads',fmt(ke)+' MW')+ro('Launcher power in the study','192 MW')+ro('Time on the track',(V/A).toFixed(1)+' s')+ro('Exit speed','2,400 m/s');
  }
  function aim(){
    const e=Math.pow(10,+$('md-e').value);$('md-eo').textContent=e<1e-2?e.toExponential(0)+' m/s':e.toFixed(2)+' m/s';
    const miss=e*60*3600; // m, at ~60 h
    const cx=160,cy=120,scale=120/1000;let s=`<polygon points="${cx},${cy-80} ${cx-69},${cy+40} ${cx+69},${cy+40}" fill="none" stroke="var(--ice)" stroke-dasharray="4 3"/><text class="lab" x="${cx}" y="${cy+58}" text-anchor="middle">catcher, 1 km triangle</text>`;
    const rn=rng(5);let hit=0;
    for(let i=0;i<80;i++){const u=rn(),v=rn(),rr=Math.sqrt(-2*Math.log(u+1e-9))*Math.cos(2*Math.PI*v)*miss,aa=rn()*Math.PI*2,x=cx+rr*Math.cos(aa)*scale,y=cy+rr*Math.sin(aa)*scale;
      const inTri=(()=>{const d=(px,py,ax,ay,bx,by)=>(px-bx)*(ay-by)-(ax-bx)*(py-by);const p=[x,y],a=[cx,cy-80],b=[cx-69,cy+40],c=[cx+69,cy+40];const d1=d(...p,...a,...b),d2=d(...p,...b,...c),d3=d(...p,...c,...a);return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));})();
      if(inTri)hit++;if(x>0&&x<320&&y>0&&y<240)s+=`<circle cx="${x}" cy="${y}" r="2.2" fill="${inTri?'var(--food)':'#C4664E'}"/>`;}
    s+=`<text class="lab2" x="10" y="18">typical miss ≈ ${miss<1000?fmt(miss)+' m':fmt(miss/1000,1)+' km'}</text><text class="lab2" x="10" y="34">${Math.round(hit/80*100)} % land in the catch area</text>`;
    $('md-aim').innerHTML=s;
  }
  ['md-m','md-r','md-d'].forEach(id=>$(id).addEventListener('input',read));$('md-e').addEventListener('input',aim);read();aim();
  this.start=()=>{last=0;if(!prefersReduced)this.raf=requestAnimationFrame(frame);else{frame(performance.now());cancelAnimationFrame(this.raf);}};this.start();
},stop(){cancelAnimationFrame(this.raf);}};

/* ---------- Construction ---------- */
const BUILD_COST=[2.8,3.7,6.0,6.7,7.8,7.1,7.6,11.8,16.2,16.0,18.4,13.8,9.0,9.4,6.8,7.3,7.0,7.0,6.6,7.1,7.1,7.1];
const PHASES=[[1,5,'Research on Earth','Laboratory and engineering work before anything flies.'],[5,9,'Tests in low Earth orbit','The Shuttle and a heavy-lift launch vehicle become available in year 5.'],[9,13,'Moon and L5','Lunar base, mass driver, mass catcher and construction shack. Lunar processing equipment arrives in year 10; oxygen made in space cuts transport costs from year 12.'],[14,19,'Habitat construction','Six years of shell, spokes and hub, built from lunar aluminum.'],[19,23,'Shield and colonists','The shield is completed, colonists arrive from year 20, and 10,000 live there by year 23.']];
PAGES.build={raf:0,init(){
  const ph=$('bd-ph');ph.innerHTML=PHASES.map(p=>`<li><b>Years ${p[0]}–${p[1]}</b>${p[2]}. ${p[3]}</li>`).join('');
  function draw(){
    const y=+$('bd-y').value;$('bd-yo').textContent=`${y} (${yrCal(y)})`;
    ph.querySelectorAll('li').forEach((li,i)=>{const p=PHASES[i];li.classList.toggle('on',y>=p[0]&&y<=p[1]);li.classList.toggle('done',y>p[1]);});
    const mass=Math.max(0,Math.min(11,(y-11)*1.1)),shellF=Math.max(0,Math.min(1,(y-13)/6)),shieldF=Math.max(0,Math.min(1,mass/9.9)),col=y<20?0:Math.min(10000,Math.round((y-19)/3*10000)),spend=BUILD_COST.slice(0,Math.min(y,22)).reduce((a,b)=>a+b,0),ssps=SSPS_USE[y]||0;
    // drawing: Earth, Moon, L5 colony
    let s=`<defs>${marker('bd-a','#FFD98A')}</defs>`;
    s+=`<circle cx="70" cy="210" r="34" fill="#2f5f93" stroke="var(--ice)"/><text class="lab2" x="70" y="268" text-anchor="middle">Earth</text>`;
    s+=`<circle cx="690" cy="330" r="16" fill="#8a8f98" stroke="var(--ice)"/><text class="lab2" x="690" y="364" text-anchor="middle">Moon</text>`;
    if(y>=9)s+=`<rect x="680" y="300" width="20" height="8" fill="var(--signal)"/><text class="lab" x="712" y="300">base</text>`;
    if(y>=12)s+=`<path class="arrow flow" d="M680,318 C640,260 600,250 560,230"/><text class="lab" x="560" y="214">mass driver to L2, then L5</text>`;
    if(y>=5)s+=`<path class="arrow flow" d="M104,196 C190,150 270,150 330,170" marker-end="url(#bd-a)"/><text class="lab" x="140" y="146">${y<9?'tests in low orbit':'people and equipment'}</text>`;
    // colony at L5 (top view)
    const cx=420,cy=210,Rr=110;
    s+=`<text class="lab2" x="${cx}" y="${cy-150}" text-anchor="middle">L5</text>`;
    if(y>=9)s+=`<rect x="${cx+130}" y="${cy-120}" width="26" height="16" fill="none" stroke="var(--ice)"/><text class="lab" x="${cx+162}" y="${cy-108}">construction shack</text>`;
    if(y>=13){s+=`<circle cx="${cx}" cy="${cy}" r="12" fill="var(--ink-2)" stroke="var(--ice)"/>`;
      for(let k=0;k<6;k++){const a=k*Math.PI/3;if(shellF>k/6)s+=`<line x1="${cx+12*Math.cos(a)}" y1="${cy+12*Math.sin(a)}" x2="${cx+(Rr-10)*Math.cos(a)}" y2="${cy+(Rr-10)*Math.sin(a)}" stroke="var(--ice)" stroke-width="2"/>`;}
      const arc=(r0,f,cls,w)=>{if(f<=0)return '';const a1=-Math.PI/2+f*2*Math.PI-1e-4,lg=f>.5?1:0;return `<path d="M${cx},${cy-r0} A${r0},${r0} 0 ${lg} 1 ${cx+r0*Math.cos(a1)},${cy+r0*Math.sin(a1)}" fill="none" stroke="${cls}" stroke-width="${w}"/>`;};
      s+=arc(Rr,shellF,'#b4bec8',12)+arc(Rr+12,shieldF,'#8a7d6d',9);}
    if(ssps>0)for(let i=0;i<Math.min(ssps,12);i++)s+=`<rect x="${150+i*16}" y="320" width="11" height="6" fill="var(--o2)"/>`;
    if(ssps>0)s+=`<text class="lab" x="150" y="344">power satellites in geosynchronous orbit: ${ssps}</text>`;
    if(col>0)s+=`<text class="lab2" x="${cx}" y="${cy+4}" text-anchor="middle">${fmt(col)}</text>`;
    $('bd-draw').innerHTML=s;
    $('bd-read').innerHTML=ro('Spending this year',y<=22?'$'+BUILD_COST[y-1].toFixed(1)+' B':'commercial phase')+ro('Spent so far','$'+spend.toFixed(1)+' B')+ro('Lunar material delivered',mass.toFixed(1)+' Mt')+ro('Colonists',fmt(col))+ro('Power satellites in use',ssps);
  }
  $('bd-y').addEventListener('input',draw);draw();
  $('bd-play').onclick=()=>{if(this.raf){cancelAnimationFrame(this.raf);this.raf=0;$('bd-play').textContent='Play 22 years';return;}
    let t0=0;const y0=+$('bd-y').value>=23?1:+$('bd-y').value;$('bd-play').textContent='Pause';
    const step=ts=>{if(!t0)t0=ts;const y=Math.min(23,y0+Math.floor((ts-t0)/700));$('bd-y').value=y;draw();if(y<23)this.raf=requestAnimationFrame(step);else{this.raf=0;$('bd-play').textContent='Play again';}};
    this.raf=requestAnimationFrame(step);};
},stop(){cancelAnimationFrame(this.raf);this.raf=0;}};

/* ---------- Design your own ---------- */
const REFS=[
  {n:'Stanford Torus',pop:10000,mpp:(0.15+9.9)*1e6/10000,src:'SP-413'},
  {n:'Sphere, R 895 m',pop:75000,mpp:(3.545+46.7)*1e6/75000,src:'SP-413 Table 4-1'},
  {n:'Dumbbell',pop:10000,mpp:(0.38+33.5)*1e6/10000,src:'SP-413 Table 4-1'},
  {n:'Banded torus',pop:10000,mpp:(0.112+7.0)*1e6/10000,src:'SP-413 Table 4-1'},
  {n:'Sphere, relaxed criteria',pop:10000,mpp:(0.0646+3.3)*1e6/10000,src:'SP-413 Table 4-2'},
  {n:'Island One',pop:10000,mpp:(0.1+3)*1e6/10000,src:'The High Frontier'}];
const PRESETS={'Stanford Torus':{shape:'torus',R:830,r:65,L:8950,w:1,s:4.5,a:67},'Island One':{shape:'sphere',R:256,r:65,L:8950,w:1.9,s:4.5,a:41},'Study sphere':{shape:'sphere',R:895,r:65,L:8950,w:1,s:4.5,a:67},'Study cylinder':{shape:'cylinder',R:895,r:65,L:8950,w:1,s:4.5,a:67},'Island Three':{shape:'cylinder',R:3200,r:65,L:32000,w:.53,s:0,a:67}};
PAGES.design={init(){
  let shape='torus';
  $('dz-pre').innerHTML='<span class="eyebrow" style="align-self:center;margin:0 6px 0 0">Presets</span>'+Object.keys(PRESETS).map(k=>`<button type="button" class="btn" data-pre="${k}">${k}</button>`).join('');
  $('dz-pre').querySelectorAll('[data-pre]').forEach(b=>b.onclick=()=>{const p=PRESETS[b.dataset.pre];shape=p.shape;$('dz-R').value=Math.log10(p.R);$('dz-r').value=p.r;$('dz-L').value=Math.log10(p.L);$('dz-w').value=p.w;$('dz-s').value=p.s;$('dz-a').value=p.a;draw();});
  document.querySelectorAll('[data-shape]').forEach(b=>b.onclick=()=>{shape=b.dataset.shape;draw();});
  const RHO=2700,SIG=200e6,P=50.8e3,AIR=.6;
  function calc(){
    const R=Math.pow(10,+$('dz-R').value),r=+$('dz-r').value,L=Math.pow(10,+$('dz-L').value),rpm=+$('dz-w').value,sh=+$('dz-s').value,app=+$('dz-a').value;
    const w=omegaOf(rpm),g=w*w*R/G0,den=SIG-RHO*w*w*R*R;
    let t,struct,area,vol,shA,los;
    if(shape==='torus'){t=P*r/den;struct=RHO*t*4*Math.PI*Math.PI*R*r;area=2*Math.PI*R*2*r;vol=2*Math.PI*Math.PI*R*r*r;shA=4*Math.PI*Math.PI*R*(r+2);los=2*Math.sqrt(Math.max(0,2*R*r-r*r));}
    else if(shape==='sphere'){t=P*R/(2*den);struct=RHO*t*4*Math.PI*R*R;area=2*Math.PI*R*R;vol=4/3*Math.PI*R*R*R;shA=4*Math.PI*(R+2)*(R+2);los=2*R;}
    else{t=P*R/den;struct=RHO*t*2*Math.PI*R*L+RHO*t/2*4*Math.PI*R*R;area=2*Math.PI*R*L;vol=Math.PI*R*R*L+4/3*Math.PI*R*R*R;shA=2*Math.PI*(R+2)*L+4*Math.PI*(R+2)*(R+2);los=L+2*R;}
    const ok=den>0,shield=sh*shA*1000,pop=area/app,mpp=ok?(struct+shield)/1000/pop:Infinity;
    return {R,r,L,rpm,sh,app,g,t,struct,area,vol,shield,pop,mpp,los,ok,w,Rmax:SIG/(RHO*w*w*R)};
  }
  function draw(){
    const c=calc();document.querySelectorAll('[data-shape]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.shape===shape));
    $('dz-rwrap').hidden=shape!=='torus';$('dz-lwrap').hidden=shape!=='cylinder';
    $('dz-Ro').textContent=fmt(c.R)+' m';$('dz-ro').textContent=c.r+' m';$('dz-Lo').textContent=fmt(c.L)+' m';$('dz-wo').textContent=c.rpm.toFixed(2)+' rpm';$('dz-so').textContent=c.sh.toFixed(1)+' t/m²';$('dz-ao').textContent=c.app+' m²';
    const chk=(st,t,sub)=>`<li><span class="st ${st}">${st==='ok'?'✓':st==='warn'?'~':'✕'}</span><span>${t}<small>${sub}</small></span></li>`;
    const gS=c.g>=.895&&c.g<=1.005?'ok':(c.g>=.7&&c.g<=1.1?'warn':'bad');
    const wS=c.rpm<=1.001?'ok':c.rpm<=3?'warn':'bad';
    const sS=c.sh>=4.5?'ok':c.sh>=2?'warn':'bad';
    $('dz-checks').innerHTML=(c.ok?'':chk('bad','Structure cannot hold itself','Aluminum at 200 MPa cannot carry its own spin weight at this radius and spin.'))+
      chk(gS,`Gravity ${c.g.toFixed(2)} g`,'Study criterion 0.95 ± 0.05 g')+chk(wS,`Spin ${c.rpm.toFixed(2)} rpm`,wS==='ok'?'Within the study’s 1 rpm limit':'Above 1 rpm; the study notes people adapt below about 3 rpm')+
      chk(sS,`Shield ${c.sh.toFixed(1)} t/m²`,'Study design 4.5 t/m² for 0.5 rem per year')+chk(c.los>=600?'ok':'warn',`Longest line of sight ${fmt(c.los)} m`,'Long sight lines were a qualitative criterion');
    $('dz-read').innerHTML=ro('Population at '+c.app+' m²',fmt(c.pop))+ro('Projected area',fmt(c.area/1e4,1)+' ha')+ro('Hull thickness',c.ok?(c.t*100).toFixed(1)+' cm':'n/a')+ro('Structure',c.ok?fmtM(c.struct):'n/a')+ro('Shield',fmtM(c.shield))+ro('Air',fmtM(c.vol*AIR))+ro('Mass per person',c.ok?fmt(c.mpp)+' t':'n/a')+ro('Largest radius at this spin',fmt(c.Rmax)+' m');
    section(c);compare(c);
  }
  const fmtM=kg=>kg>=1e9?fmt(kg/1e9,1)+' Mt':fmt(kg/1e6,0)+' kt';
  function section(c){
    const W=760,H=200,pad=30;let s='';const span=shape==='cylinder'?Math.max(c.L+2*c.R,2*c.R):2*(c.R+(shape==='torus'?c.r:0));const k=Math.min((W-2*pad)/span,(H-60)/(2*(c.R+(shape==='torus'?c.r:0))));
    const cx=W/2,cy=H/2-6;
    if(shape==='torus'){s+=`<line x1="${cx}" y1="${cy-c.R*k-20}" x2="${cx}" y2="${cy+c.R*k+20}" stroke="var(--line)" stroke-dasharray="2 4"/>`;
      [-1,1].forEach(sg=>{s+=`<circle cx="${cx+sg*c.R*k}" cy="${cy}" r="${Math.max(1.5,c.r*k)}" fill="var(--ink-2)" stroke="var(--ice)" stroke-width="1.4"/>`;});
      s+=`<line x1="${cx-c.R*k}" y1="${cy}" x2="${cx+c.R*k}" y2="${cy}" stroke="var(--line)"/>`;}
    else if(shape==='sphere')s+=`<circle cx="${cx}" cy="${cy}" r="${c.R*k}" fill="var(--ink-2)" stroke="var(--ice)" stroke-width="1.4"/><line x1="${cx-c.R*k-14}" y1="${cy}" x2="${cx+c.R*k+14}" y2="${cy}" stroke="var(--line)" stroke-dasharray="2 4"/>`;
    else{const hl=c.L/2*k,rr=c.R*k;s+=`<path d="M${cx-hl},${cy-rr} L${cx+hl},${cy-rr} A${rr},${rr} 0 0 1 ${cx+hl},${cy+rr} L${cx-hl},${cy+rr} A${rr},${rr} 0 0 1 ${cx-hl},${cy-rr} Z" fill="var(--ink-2)" stroke="var(--ice)" stroke-width="1.4"/><line x1="${cx-hl-rr-14}" y1="${cy}" x2="${cx+hl+rr+14}" y2="${cy}" stroke="var(--line)" stroke-dasharray="2 4"/>`;}
    s+=`<text class="lab" x="12" y="${H-12}">section · spin axis dashed${shape==='torus'?' (vertical)':''} · ${shape==='torus'?'ring '+fmt(2*(c.R+c.r))+' m across':shape==='sphere'?fmt(2*c.R)+' m across':fmt(2*c.R)+' × '+fmt(c.L+2*c.R)+' m'}</text>`;
    $('dz-sec').innerHTML=s;
  }
  function compare(c){
    const L=70,R=1080,T=16,B=300,X=p=>L+(R-L)*(Math.log10(p)-3)/4,Y=m=>B-(B-T)*(Math.log10(m)-1)/3;let s='';
    [1e3,1e4,1e5,1e6,1e7].forEach(p=>{s+=`<line class="grid" x1="${X(p)}" x2="${X(p)}" y1="${T}" y2="${B}"/><text class="tick" x="${X(p)}" y="${B+14}" text-anchor="middle">${fmt(p)}</text>`;});
    [10,100,1000,10000].forEach(m=>{s+=`<line class="grid" x1="${L}" x2="${R}" y1="${Y(m)}" y2="${Y(m)}"/><text class="tick" x="${L-6}" y="${Y(m)+3}" text-anchor="end">${fmt(m)}</text>`;});
    s+=`<text class="lab" x="${(L+R)/2}" y="${B+30}" text-anchor="middle">population</text><text class="lab" x="12" y="${(T+B)/2}" transform="rotate(-90 12 ${(T+B)/2})" text-anchor="middle">tonnes per person</text>`;
    REFS.forEach((p,i)=>{s+=`<circle cx="${X(p.pop)}" cy="${Y(p.mpp)}" r="5" fill="var(--ink-2)" stroke="var(--ice)" stroke-width="1.4"/><text class="lab2" x="${X(p.pop)+(i%2?-9:9)}" text-anchor="${i%2?'end':'start'}" y="${Y(p.mpp)+4+(i===5?8:i===4?-4:0)}">${p.n}</text>`;});
    if(c.ok&&isFinite(c.mpp)){const x=Math.min(R,Math.max(L,X(Math.max(1000,c.pop)))),y=Math.min(B,Math.max(T,Y(Math.min(1e4,Math.max(10,c.mpp)))));s+=`<circle cx="${x}" cy="${y}" r="7" fill="var(--signal)"/><text class="lab2" x="${x>R-80?x-12:x}" y="${y-14}" text-anchor="${x>R-80?'end':'middle'}" fill="var(--signal)">your design</text>`;}
    $('dz-cmp').innerHTML=s;
  }
  ['dz-R','dz-r','dz-L','dz-w','dz-s','dz-a'].forEach(id=>$(id).addEventListener('input',draw));draw();
}};

let pageOn=null;const inited_p={};
function showPage(id){
  htmlEl.dataset.mode='page';
  document.querySelectorAll('.tpage').forEach(p=>p.hidden=p.id!=='p-'+id);
  if(pageOn&&pageOn!==id&&PAGES[pageOn].stop)PAGES[pageOn].stop();
  if(!inited_p[id]){inited_p[id]=true;PAGES[id].init();}else if(PAGES[id].start)PAGES[id].start();
  pageOn=id;window.scrollTo(0,0);
}
function stopPage(){if(pageOn&&PAGES[pageOn].stop)PAGES[pageOn].stop();pageOn=null;}

/* ================================================================== */
/*  Intro screen: habitat cards, Earth-Moon map, routing               */
/* ================================================================== */
const CARD={
  torus:{tag:'1975 · NASA Ames / Stanford',ds:'A wheel 1.8 km across, turning once a minute, for 10,000 people.',fx:[['Spin','1 rpm'],['Gravity','0.95 g'],['People','10,000']],
    svg:`<ellipse class="lt" cx="110" cy="90" rx="96" ry="33"/><ellipse class="ln" cx="110" cy="90" rx="90" ry="29"/><ellipse class="ln" cx="110" cy="90" rx="76" ry="21"/>
      <g class="ln">${[0,60,120,180,240,300].map(a=>{const r=a*Math.PI/180;return `<line x1="110" y1="90" x2="${110+83*Math.cos(r)}" y2="${90+25*Math.sin(r)}"/>`;}).join('')}</g>
      <circle class="fl" cx="110" cy="90" r="7"/><ellipse class="ac" cx="110" cy="26" rx="28" ry="9" transform="rotate(-24 110 26)"/><line class="lt" x1="110" y1="35" x2="110" y2="83" stroke-dasharray="2 3"/><rect class="ln" x="104" y="97" width="12" height="16"/>`},
  bernal:{tag:'1976 · Island One',ds:'A sphere one mile around, with farm rings on its axis, for 10,000 people.',fx:[['Spin','≈1.9 rpm'],['Gravity','1 g at equator'],['People','10,000']],
    svg:`<line class="lt" x1="110" y1="4" x2="110" y2="136" stroke-dasharray="2 3"/><circle class="fl" cx="110" cy="70" r="38"/><ellipse class="gr" cx="110" cy="70" rx="38" ry="9"/><ellipse class="lt" cx="110" cy="58" rx="36" ry="8"/><ellipse class="lt" cx="110" cy="82" rx="36" ry="8"/>
      ${[24,16,8].map(y=>`<ellipse class="ln" cx="110" cy="${y}" rx="20" ry="4.5"/>`).join('')}${[116,124,132].map(y=>`<ellipse class="ln" cx="110" cy="${y}" rx="20" ry="4.5"/>`).join('')}
      <path class="ac" d="M76,34 L92,40 M144,34 L128,40"/>`},
  island2:{tag:'1976 · Island Two',ds:'A sphere about 1.8 km across, for 140,000 people in hill-town villages.',fx:[['Spin','≈1 rpm'],['Gravity','1 g at equator'],['People','140,000']],
    svg:`<line class="lt" x1="110" y1="2" x2="110" y2="138" stroke-dasharray="2 3"/><circle class="fl" cx="110" cy="70" r="52"/><ellipse class="gr" cx="110" cy="70" rx="52" ry="12"/><ellipse class="ln" cx="110" cy="70" rx="52" ry="4" style="stroke:var(--water)"/><ellipse class="lt" cx="110" cy="52" rx="48" ry="11"/><ellipse class="lt" cx="110" cy="88" rx="48" ry="11"/>
      ${[12,6].map(y=>`<ellipse class="ln" cx="110" cy="${y}" rx="16" ry="3.5"/>`).join('')}${[128,134].map(y=>`<ellipse class="ln" cx="110" cy="${y}" rx="16" ry="3.5"/>`).join('')}<circle class="ac" cx="146" cy="128" r="5"/><circle class="ac" cx="158" cy="124" r="3"/>`},
  model1:{tag:'1976 · early design',ds:'A small cylinder with homes in shielded end caps and farms in its valleys.',fx:[['Spin','≈3 rpm'],['Size','≈200 × 850 m'],['People','not stated']],
    svg:`<line class="lt" x1="110" y1="2" x2="110" y2="138" stroke-dasharray="2 3"/><path class="fl" d="M96,34 A14,14 0 0 1 124,34 L124,104 A14,14 0 0 1 96,104 Z"/><line class="gr" x1="100" y1="40" x2="100" y2="98"/><line class="lt" x1="118" y1="40" x2="118" y2="98"/>
      <path d="M92,30 A18,18 0 0 1 128,30" class="ln" style="stroke:#b3a184;stroke-width:3"/><path d="M92,108 A18,18 0 0 0 128,108" class="ln" style="stroke:#b3a184;stroke-width:3"/>
      <path class="ac" d="M96,34 L78,20 M124,34 L142,20 M96,104 L74,92 M124,104 L146,92"/><path class="ac" d="M66,126 L60,114 M154,126 L160,114"/><line class="ac" x1="132" y1="104" x2="160" y2="40"/><line class="ln" x1="110" y1="4" x2="110" y2="20"/>`},
  oneill:{tag:'1976 · Island Three',ds:'Two counter-rotating cylinders 32 km long, for several million people.',fx:[['Spin','≈0.53 rpm'],['Gravity','≈1 g'],['People','millions']],
    svg:`<g transform="rotate(-14 110 70)">${[52,96].map(y=>`<path class="fl" d="M34,${y-13} L172,${y-13} A6,13 0 0 1 172,${y+13} L34,${y+13} A6,13 0 0 1 34,${y-13} Z"/><ellipse class="ln" cx="34" cy="${y}" rx="6" ry="13"/><line class="lt" x1="36" y1="${y-4}" x2="172" y2="${y-4}"/><line class="lt" x1="36" y1="${y+5}" x2="172" y2="${y+5}"/>
      <path class="ac" d="M40,${y-13} L180,${y-30} M40,${y+13} L180,${y+30}"/>`).join('')}<line class="ln" x1="22" y1="52" x2="22" y2="96"/><line class="ln" x1="186" y1="52" x2="186" y2="96"/></g>`}
};
function renderCards(){
  const card=(k,compact)=>{const s=SETTLEMENTS[k],c=CARD[k];return `<button type="button" class="card" data-open="${k}"><svg viewBox="0 0 220 140" aria-hidden="true">${c.svg}</svg><span class="tag">${c.tag}</span><span class="nm">${s.name}</span><p class="ds">${c.ds}</p><span class="fx">${c.fx.map(([a,b])=>`<span>${a} <b>${b}</b></span>`).join('')}</span><span class="go">Examine →</span></button>`;};
  $('cards').innerHTML=SET_ORDER.map(k=>card(k)).join('');
  $('cards2').innerHTML=SET_ORDER.map(k=>card(k,true)).join('');
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>{location.hash=b.dataset.open;}));
  document.querySelectorAll('[data-jump]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const t=$(a.dataset.jump);if(t)t.scrollIntoView({behavior:prefersReduced?'auto':'smooth',block:'start'});}));
}

/* Map in the frame turning with the Moon. Earth at (280,260); 0.00064 px per km */
const EX=280,EY=260,KM=0.00064,MR=384400*KM;
const L4=[EX+MR*Math.cos(Math.PI/3),EY-MR*Math.sin(Math.PI/3)],L5=[EX+MR*Math.cos(Math.PI/3),EY+MR*Math.sin(Math.PI/3)];
const LOC={
  earth:{x:EX,y:EY,lab:'Earth',lx:0,ly:-16,title:'Earth',text:['Home, workforce and market. Earth’s gravity well is 22 times deeper than the Moon’s, so lifting the colony’s ten million tonnes from here was never an option. In the study, people, machines and supplies come up from Earth, and nearly all of the mass comes from the Moon.'],facts:[['Escape speed','11.2 km/s'],['Distance to Moon','384,400 km']]},
  geo:{x:EX-19.1,y:EY+19.1,lab:'GEO',lx:-14,ly:12,anchor:'end',title:'Geosynchronous orbit',text:['35,786 km above the equator, where a satellite keeps pace with Earth’s rotation and hangs over one spot. Solar power satellites built at the colony would be placed here to send electricity down to receiving stations on the ground. Their sale was meant to pay for the settlements.'],facts:[['Altitude','35,786 km'],['Role','Solar power satellites']]},
  high:{x:EX-109.6,y:EY-109.6,lab:'High orbit',lx:-10,ly:-10,anchor:'end',title:'High orbits',text:['By 1976 O’Neill was less attached to L5. For Island One he suggested a high circular orbit with a period of a few days, partway out toward the Moon, or an eccentric orbit with a period of two weeks, half the Moon’s. Either avoids frequent eclipses and Earth’s radiation belts while staying easy to reach.','For convenience he used “L5” as a nickname for any orbit above the radiation belts and no farther than the Moon.'],facts:[['Proposed for','Island One'],['Source','The High Frontier']]},
  l1:{x:EX+326400*KM,y:EY,lab:'L1',lx:0,ly:-14,title:'L1',text:['Between Earth and the Moon, about 58,000 km from the Moon. A saddle point: an object displaced across the Earth–Moon line slides back, but one displaced along it keeps going. Holding position here takes continual thrust.'],facts:[['From the Moon','≈58,000 km'],['Stability','Unstable']]},
  l2:{x:EX+448900*KM,y:EY,lab:'L2',lx:0,ly:-14,title:'L2 · the mass catcher',text:['About 64,500 km beyond the Moon. Also unstable, but the study chose it as the target for lunar material. It is about one-seventh as far from the Moon as L5, which allows a smaller catcher or a less accurate launcher. It keeps the stream of payloads away from the colony’s traffic, and it can be reached from a launcher on the Moon’s near side.','An active catcher of nets on motor-driven cables tracks incoming payloads by radar.'],facts:[['Beyond the Moon','≈64,500 km'],['Stability','Unstable'],['Role','Mass catcher']]},
  l3:{x:EX-381700*KM,y:EY,lab:'L3',lx:0,ly:-14,title:'L3',text:['On the far side of Earth, opposite the Moon. Like L1 and L2 it is a saddle point and needs station keeping, and it is too remote from the Moon to be useful for building.'],facts:[['Stability','Unstable']]},
  l4:{x:L4[0],y:L4[1],lab:'L4',lx:14,ly:4,anchor:'start',title:'L4',text:['Sixty degrees ahead of the Moon on its orbit, as far from Earth as from the Moon. A stable bowl: an object displaced in any direction returns. The study judged it practically interchangeable with L5.'],facts:[['From Earth and Moon','384,400 km each'],['Stability','Stable region']]},
  l5:{x:L5[0],y:L5[1],lab:'L5',lx:14,ly:4,anchor:'start',title:'L5 · the colony site',text:['Sixty degrees behind the Moon on its orbit, 384,400 km from both Earth and Moon. The 1975 study placed the Stanford Torus here.','Once the Sun’s pull is included, the point itself is no longer stable, but large orbits around it are. A colony would circle the point in a wide, slow loop while keeping company with the Earth and Moon. The site gave its name to the L5 Society.'],facts:[['From Earth and Moon','384,400 km each'],['Stability','Stable orbits around it'],['Trip from low orbit','≈5 days']]},
  moon:{x:EX+MR,y:EY,lab:'Moon',lx:0,ly:24,title:'The Moon · mine and launcher',text:['The quarry. The study’s mining base sits on the near side, where Apollo samples had been gathered, where smooth plains suit a long launcher, and where Earth is always in view for communications.','A mass driver levitates buckets of compacted lunar soil on a magnetic track, accelerates them at 30 g and releases them toward L2, one to five buckets every second. Ten million tonnes of lunar material go into the first colony.'],facts:[['Escape speed','2.4 km/s'],['Launch rate','1–5 buckets per second'],['Acceleration','30 g']]}
};
const ROUTE=[
  {d:`M${EX+4},${EY-9} C${EX+20},${EY-40} ${EX+38},${EY-10} ${EX+14},${EY+6}`,lx:EX+40,ly:EY-30,t:'Earth to low orbit. People, machines and supplies launch on heavy-lift rockets.'},
  {d:`M${EX+12},${EY+10} C${EX+70},${EY+120} ${L5[0]-60},${L5[1]-30} ${L5[0]-8},${L5[1]-4}`,lx:EX+70,ly:EY+140,t:'Low orbit to L5. A transfer vehicle carries crews and freight to the colony site in about five days.'},
  {d:`M${EX+MR-5},${EY+3} C${EX+MR-10},${EY+40} ${EX+448900*KM-6},${EY+42} ${EX+448900*KM},${EY+8}`,lx:EX+MR+22,ly:EY+52,t:'Moon to L2. The mass driver launches compacted lunar soil toward L2, where the catcher nets it.'},
  {d:`M${EX+448900*KM+4},${EY+12} C${EX+448900*KM+40},${EY+170} ${L5[0]+90},${L5[1]+10} ${L5[0]+9},${L5[1]+2}`,lx:EX+448900*KM+30,ly:EY+150,t:'L2 to L5. Transfer vehicles carry the material on to the colony, where it is refined into aluminum, glass and shielding.'},
  {d:`M${L5[0]-10},${L5[1]-8} C${L5[0]-70},${L5[1]-60} ${EX-10},${EY+90} ${EX-16},${EY+26}`,lx:EX-28,ly:EY+120,t:'L5 to geosynchronous orbit. Finished solar power satellites are moved into place to supply Earth.'}
];
let mapMode='places',mapSel='l5',routeStep=-1;
function renderMap(){
  let s='';
  s+=`<circle class="orb" cx="${EX}" cy="${EY}" r="${MR}"/><circle class="orb2" cx="${EX}" cy="${EY}" r="${155}"/><circle class="orb2" cx="${EX}" cy="${EY}" r="${42164*KM}"/>`;
  s+=`<text class="lab" x="${EX+MR*Math.cos(-2.4)}" y="${EY+MR*Math.sin(-2.4)-8}" text-anchor="middle">Moon’s orbit</text>`;
  [[L4,30],[L5,-30]].forEach(([p,a])=>{s+=`<ellipse class="stab" cx="${p[0]}" cy="${p[1]}" rx="50" ry="17" transform="rotate(${a} ${p[0]} ${p[1]})"/>`;});
  s+=`<text class="lab" x="${L5[0]-60}" y="${L5[1]+30}" text-anchor="end">stable orbits</text>`;
  s+=`<line x1="${EX-MR}" y1="${EY}" x2="${EX+448900*KM+20}" y2="${EY}" stroke="var(--line)" stroke-dasharray="1 4"/>`;
  s+=`<line x1="${EX}" y1="${EY}" x2="${L5[0]}" y2="${L5[1]}" stroke="var(--line)" stroke-dasharray="1 4"/><line x1="${EX+MR}" y1="${EY}" x2="${L5[0]}" y2="${L5[1]}" stroke="var(--line)" stroke-dasharray="1 4"/>`;
  s+=`<text class="lab" x="${EX+40}" y="${EY+82}" transform="rotate(60 ${EX+40} ${EY+82})">384,400 km</text><text class="lab" x="${EX+MR-34}" y="${EY+120}" transform="rotate(-60 ${EX+MR-34} ${EY+120})">384,400 km</text>`;
  s+=`<g><line class="scale" x1="20" y1="500" x2="${20+100000*KM}" y2="500"/><line class="scale" x1="20" y1="495" x2="20" y2="505"/><line class="scale" x1="${20+100000*KM}" y1="495" x2="${20+100000*KM}" y2="505"/><text class="lab" x="20" y="488">100,000 km</text></g>`;
  s+=`<text class="lab" x="600" y="24" text-anchor="end">Moon moves this way ↑</text>`;
  s+=`<g id="rtg" ${mapMode==='route'?'':'style="display:none"'}>${ROUTE.map((r,i)=>`<path class="rt${routeStep>=0&&routeStep!==i?' dim':''}" d="${r.d}"/><text class="rtl" x="${r.lx}" y="${r.ly}" ${routeStep>=0&&routeStep!==i?'opacity=".25"':''}>${i+1}</text>`).join('')}</g>`;
  Object.entries(LOC).forEach(([k,p])=>{
    const on=mapMode==='places'&&k===mapSel;
    let mk;
    if(k==='earth')mk=`<circle class="mk" cx="${p.x}" cy="${p.y}" r="9" style="fill:#2f5f93"/>`;
    else if(k==='moon')mk=`<circle class="mk" cx="${p.x}" cy="${p.y}" r="5.5" style="fill:#8a8f98"/>`;
    else if(k==='geo'||k==='high')mk=`<circle class="mk" cx="${p.x}" cy="${p.y}" r="3.5"/>`;
    else mk=`<rect class="mk" x="${p.x-4.5}" y="${p.y-4.5}" width="9" height="9" transform="rotate(45 ${p.x} ${p.y})"/>`;
    s+=`<g class="pt${on?' on':''}" data-loc="${k}" tabindex="0" role="button" aria-label="${p.title}"><circle class="hit" cx="${p.x}" cy="${p.y}" r="18"/>${mk}<text x="${p.x+(p.lx||0)}" y="${p.y+(p.ly||0)}" text-anchor="${p.anchor||'middle'}">${p.lab}</text></g>`;
  });
  $('emap').innerHTML=s;
  $('emap').querySelectorAll('.pt').forEach(g=>{const f=()=>{mapMode='places';mapSel=g.dataset.loc;syncMap();};g.addEventListener('click',f);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f();}});});
}
function renderInfo(){
  const el=$('minfo');
  if(mapMode==='route'){
    el.innerHTML=`<p class="eyebrow">Supply route · SP-413</p><h3>Ten million tonnes from the Moon</h3><p>The study’s system lifts people and their equipment from Earth and brings nearly all of the colony’s mass across from the Moon.</p>
      <div class="steps">${ROUTE.map((_,i)=>`<button type="button" class="btn" data-st="${i}" aria-pressed="${routeStep===i}">${i+1}</button>`).join('')}<button type="button" class="btn" data-st="-1" aria-pressed="${routeStep<0}">All</button></div>
      <p>${routeStep<0?'All five legs at once. Pick a number to follow one.':(routeStep+1)+'. '+ROUTE[routeStep].t}</p>`;
    el.querySelectorAll('[data-st]').forEach(b=>b.addEventListener('click',()=>{routeStep=+b.dataset.st;syncMap();}));
  }else{
    const p=LOC[mapSel];
    el.innerHTML=`<p class="eyebrow">Location</p><h3>${p.title}</h3>${p.text.map(t=>`<p>${t}</p>`).join('')}<dl>${p.facts.map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
  }
}
function syncMap(){$('mPlaces').setAttribute('aria-pressed',mapMode==='places');$('mRoute').setAttribute('aria-pressed',mapMode==='route');renderMap();renderInfo();}
$('mPlaces').onclick=()=>{mapMode='places';syncMap();};
$('mRoute').onclick=()=>{mapMode='route';syncMap();};

/* Routing between the intro and the habitat viewer */
const htmlEl=document.documentElement;let inited=false;
function init3D(){
  if(inited)return;inited=true;
  if(HAS3D){
    try{
      tmp=new THREE.Vector3();ray=new THREE.Raycaster();ptr=new THREE.Vector2();
      initScene();new ResizeObserver(resize).observe(stage);resize();
      if(document.fonts&&document.fonts.ready)document.fonts.ready.then(measure);
      requestAnimationFrame(frame);return;
    }catch(err){console.error(err);renderer=null;stage.insertAdjacentHTML('beforeend','<div class="fallback">3D view unavailable in this browser. The component sheets on the right still work.</div>');}
  }else stage.insertAdjacentHTML('beforeend','<div class="fallback">The 3D library could not load. The component sheets on the right still work.</div>');
}
function showIntro(){stopPage();htmlEl.dataset.mode='intro';}
function showApp(id){stopPage();htmlEl.dataset.mode='app';init3D();if(!world||S.id!==id||!renderer)loadSettlement(id);else resize();}
function routeFromHash(){const h=(location.hash||'').replace('#','');if(PAGES[h]){showPage(h);return;}if(SETTLEMENTS[h]){if(htmlEl.dataset.mode!=='app'||S.id!==h||!world)showApp(h);}else showIntro();}
window.addEventListener('hashchange',routeFromHash);
window.__ss={MOUNT,LIGHT,get camera(){return camera;},get controls(){return controls;},get world(){return world;},get S(){return S;},select,flyTo,viewW,setSpin,tourStop,endTour};
renderCards();syncMap();routeFromHash();
})();

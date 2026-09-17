// Prova: il dente in tre dimensioni.
//
// Serve a decidere, con una misura e uno screenshot, se Three.js entra
// nel sito dello studio. La skill `threejs-webgl-direction` chiede
// quattro esiti: materia vera del soggetto, 60 fps su desktop, si legge
// come previsto, e cosa vede chi non lo carica.
//
// Import dinamico anche qui, che e come starebbe nel sito vero:
// il chunk di three non deve entrare nel bundle principale.

async function avvia() {
const THREE = await import("three");

const scena = document.querySelector<HTMLDivElement>("#scena")!;
const spia = document.querySelector<HTMLPreElement>("#spia")!;



const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
r.setPixelRatio(Math.min(devicePixelRatio, 1.75));
r.setSize(scena.clientWidth, scena.clientHeight);
scena.appendChild(r.domElement);

const s = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(34, scena.clientWidth / scena.clientHeight, 0.1, 100);
cam.position.set(0, 0.2, 7.4);

// Il profilo di un molare, rivoluzionato: corona bombata, colletto
// stretto, poi la radice che si assottiglia.
const profilo: InstanceType<typeof THREE.Vector2>[] = [];
const punti: [number, number][] = [
  [0.02, 2.05], [0.62, 2.0], [1.05, 1.78], [1.22, 1.4], [1.18, 1.0],
  [1.0, 0.62], [0.86, 0.2], [0.8, -0.2], [0.72, -0.8], [0.52, -1.5],
  [0.3, -2.1], [0.12, -2.5], [0.02, -2.62],
];
for (const [x, y] of punti) profilo.push(new THREE.Vector2(x, y));
const geo = new THREE.LatheGeometry(profilo, 96);

// Smalto: un materiale trasmissivo, che e il punto — se il 3D serve a
// qualcosa qui, serve a mostrare che lo smalto e traslucido.
const mat = new THREE.MeshPhysicalMaterial({
  color: 0xf3f0ea, roughness: 0.22, metalness: 0,
  transmission: 0.55, thickness: 1.4, ior: 1.6,
  clearcoat: 0.9, clearcoatRoughness: 0.15,
});
const dente = new THREE.Mesh(geo, mat);
s.add(dente);

// Le cuspidi: quattro bozze sulla corona, altrimenti e un birillo.
const cusp = new THREE.SphereGeometry(0.46, 32, 24);
for (const [x, z] of [[0.52, 0.52], [-0.52, 0.52], [0.52, -0.52], [-0.52, -0.52]]) {
  const c = new THREE.Mesh(cusp, mat);
  c.position.set(x, 1.82, z); c.scale.set(1, 0.72, 1);
  s.add(c);
}

s.add(new THREE.AmbientLight(0xdfe4ec, 1.1));
const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(3, 5, 4); s.add(k);
const f = new THREE.DirectionalLight(0x8fa3d0, 1.1); f.position.set(-4, -1, 2); s.add(f);

let n = 0, t0 = performance.now(), fps = 0;
r.setAnimationLoop((t) => {
  dente.rotation.y = t * 0.00042;
  s.children.forEach((c) => { if (c instanceof THREE.Mesh) c.rotation.y = dente.rotation.y; });
  r.render(s, cam);
  n++;
  const dt = performance.now() - t0;
  if (dt >= 1000) { fps = Math.round((n * 1000) / dt); n = 0; t0 = performance.now(); spia.textContent = `${fps} fps`; }
});

// Lo legge la prova automatica.
(window as unknown as { __fps: () => number }).__fps = () => fps;
}

void avvia();

// Direzione C — lo specchio appannato.
// Shader di condensa che si dirada dove passa il puntatore. Three.js è
// caricato DINAMICAMENTE: se il dispositivo non regge o manca WebGL, la
// pagina resta leggibile e non scarica 600 KB per niente.
const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
const piccolo = matchMedia("(max-width: 720px)").matches;

function supportaWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

// Su telefono e con reduced-motion NON si carica affatto: la condensa è
// un lusso, la leggibilità no.
if (!supportaWebGL() || ridotto || piccolo) {
  document.documentElement.classList.add("senza-webgl");
} else {
  void (async () => {
    const THREE = await import("three");
    const host = document.querySelector<HTMLElement>(".specchio")!;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(innerWidth, innerHeight);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      u_time: { value: 0 },
      u_res: { value: new THREE.Vector2(innerWidth, innerHeight) },
      u_mouse: { value: new THREE.Vector2(-9, -9) },
      u_wipe: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      vertexShader: `void main(){ gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform float u_time; uniform vec2 u_res; uniform vec2 u_mouse; uniform float u_wipe;
        // rumore a valore, sufficiente per una condensa
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.02; a *= 0.5; }
          return v;
        }
        void main(){
          vec2 uv = gl_FragCoord.xy / u_res;
          vec2 asp = vec2(u_res.x/u_res.y, 1.0);
          float velo = fbm(uv*vec2(5.0,4.0) + vec2(0.0, u_time*0.02));
          // la condensa si dirada dove è passato il dito
          float d = distance(uv*asp, u_mouse*asp);
          float pulito = smoothstep(0.22, 0.0, d) * u_wipe;
          float alpha = clamp(velo*0.55 + 0.30 - pulito, 0.0, 0.92);
          // gocce che scendono lente lungo il vetro
          float goccia = smoothstep(0.985, 1.0, fbm(vec2(uv.x*40.0, uv.y*3.0 - u_time*0.06)));
          vec3 col = mix(vec3(0.09,0.07,0.05), vec3(0.85,0.79,0.70), 0.55);
          gl_FragColor = vec4(col, alpha*0.85 + goccia*0.12);
        }`,
    });

    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    addEventListener("pointermove", (e) => {
      uniforms.u_mouse.value.set(e.clientX / innerWidth, 1 - e.clientY / innerHeight);
      uniforms.u_wipe.value = 1;
    });
    addEventListener("resize", () => {
      renderer.setSize(innerWidth, innerHeight);
      uniforms.u_res.value.set(innerWidth, innerHeight);
    });

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      uniforms.u_time.value = clock.getElapsedTime();
      renderer.render(scene, camera);
    });
  })();
}

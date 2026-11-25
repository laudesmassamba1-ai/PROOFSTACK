import { type ReactNode, useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * ModernLoginSignup — composant Aceternity (dots-grid shader) intégré au projet.
 *
 * Fidèle au visuel d'origine (fond noir, grille de points animée en GLSL,
 * vignette radiale, carte sombre centrée), avec les corrections nécessaires
 * à une vraie app :
 *  - three est importé au lieu d'être injecté par <script src="cdnjs…">
 *    (la CSP du site interdit les scripts distants) ;
 *  - typage complet, plus de `any` ;
 *  - le canvas suit la taille de son conteneur (ResizeObserver), pas de la fenêtre ;
 *  - le cleanup du listener de resize est appliqué dans les deux chemins d'init ;
 *  - prefers-reduced-motion : une seule trame statique, pas de boucle.
 *
 * La démo d'origine (bascule login/signup, boutons sociaux) reste disponible
 * comme export par défaut ; l'app réelle utilise `ModernLoginSignup` comme
 * socle et passe son vrai formulaire en children.
 */

const VERTEX_SHADER = /* glsl */ `
  precision mediump float;
  uniform vec2 u_resolution;
  out vec2 fragCoord;
  void main() {
    gl_Position = vec4(position, 1.0);
    fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
    fragCoord.y = u_resolution.y - fragCoord.y;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  in vec2 fragCoord;

  uniform float u_time;
  uniform float u_opacities[10];
  uniform vec3 u_colors[6];
  uniform float u_total_size;
  uniform float u_dot_size;
  uniform vec2 u_resolution;
  uniform int u_reverse;

  out vec4 fragColor;

  float PHI = 1.61803398874989484820459;
  float random(vec2 xy) {
      return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
  }

  void main() {
      vec2 st = fragCoord.xy;
      st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
      st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

      float opacity = step(0.0, st.x) * step(0.0, st.y);

      vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

      float frequency = 5.0;
      float show_offset = random(st2);
      float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
      opacity *= u_opacities[int(rand * 10.0)];
      opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
      opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

      vec3 color = u_colors[int(show_offset * 6.0)];

      float animation_speed_factor = 3.0;
      vec2 center_grid = u_resolution / 2.0 / u_total_size;
      float dist_from_center = distance(center_grid, st2);

      float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

      float current_timing_offset = timing_offset_intro;
      opacity *= step(current_timing_offset, u_time * animation_speed_factor);
      opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);

      fragColor = vec4(color, opacity);
      fragColor.rgb *= fragColor.a;
  }
`;

/** Grille de points animée (WebGL) dessinée derrière la carte. */
function DotShaderBackground({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let renderer: THREE.WebGLRenderer | undefined;
    let material: THREE.ShaderMaterial | undefined;
    let geometry: THREE.PlaneGeometry | undefined;
    let animationId = 0;
    let observer: ResizeObserver | undefined;

    const uniforms = {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(2, 2) },
      // Trame assagie : la version d'origine saturait l'écran de points blancs
      // pleins — un fond, pas un projecteur.
      u_opacities: {
        value: [0.12, 0.12, 0.12, 0.2, 0.2, 0.2, 0.32, 0.32, 0.32, 0.45],
      },
      // Monochrome dans la version d'origine : six vecteurs blancs.
      u_colors: {
        value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3(1, 1, 1)),
      },
      u_total_size: { value: 26.0 },
      u_dot_size: { value: 4.5 },
      u_reverse: { value: 0 },
    };

    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
      // A decorative background must not compete with the form it sits behind. At a
      // phone's 2.6x ratio this canvas is several million fragments per frame, which
      // starves the main thread long enough for the six-second sign-up request to
      // abort. 1.5x keeps the dots crisp and the request alive.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    } catch {
      // WebGL indisponible : la page reste lisible, le fond tombe sur le noir uni.
      return;
    }

    material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      glslVersion: THREE.GLSL3,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
    });
    geometry = new THREE.PlaneGeometry(2, 2);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const resize = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      renderer?.setSize(width, height, false);
      uniforms.u_resolution.value.set(width * 2, height * 2);
    };
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(parent);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startTime = performance.now();
    const animate = () => {
      uniforms.u_time.value = (performance.now() - startTime) / 1000.0;
      renderer?.render(scene, camera);
      if (!reduceMotion) animationId = requestAnimationFrame(animate);
    };
    // Une trame statique laisse le temps uniformiser le rendu avant la boucle.
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      observer?.disconnect();
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${className}`} />;
}

/**
 * Socle plein écran : fond noir, grille de points, vignette, carte sombre.
 * Le contenu (formulaire réel) est passé en children ; le pied de carte
 * (bascule, mentions) en footer.
 */
export function ModernLoginSignup({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black text-white antialiased">
      <DotShaderBackground />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: "radial-gradient(circle at center, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div className="relative z-[2] flex w-full max-w-[400px] flex-col items-center rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0d0e10] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
        <div className="w-full max-w-[360px] text-center">
          <h1 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.025em]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-[0.85rem] leading-normal text-white/55">{subtitle}</p>
          ) : null}
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

export default ModernLoginSignup;

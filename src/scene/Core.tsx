import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'
import { coreFragment, coreVertex } from './shaders'

/**
 * The reactor.
 *
 * Modelled on the JARVIS: A Second Screen Experience interface rather than on
 * the suit HUD, because that is the thing this app actually is — an assistant
 * you talk to, sitting idle and listening, not a targeting display. That
 * interface is one big COMPLETE ring: a soft teal torus with a dusty, eroded
 * outer edge and a finely textured disc inside it, on near-black. There is no
 * compass, there are no gauges, and nothing is a broken arc.
 *
 * It is drawn as a single camera-facing plane with a polar fragment shader
 * rather than as geometry. Everything here is a function of radius and angle,
 * which is exactly what a shader is good at, and it means the eroded edge is
 * real per-pixel turbulence instead of a displaced mesh pretending to be a
 * ring — which is how the old build ended up with a lumpy sphere.
 */

/** The plane's half-width in world units. */
const HALF = 2.7
/** Radius, in the shader's own field units, at which the ring is drawn. */
const RING_R = 0.74
/**
 * Ring diameter as a fraction of the SHORTER viewport dimension.
 *
 * Framing has to be driven by the viewport rather than by a constant, because
 * the plane is a fixed size in world units while the frame is not: the same
 * scale that leaves a comfortable margin on a 16:9 monitor runs the ring off
 * both edges of a portrait window.
 */
const FIT = 0.60
/** O mesmo enquadramento vale para o Enxame (Enxame.tsx). */
export const FIT_DO_NUCLEO = FIT
/** O tamanho do círculo em espera, em relação ao normal. */
export const STANDBY_SCALE = 0.42
/**
 * O estilo do Enxame, o núcleo padrão desde a ADR 0013 revisada. Com ele, este anel
 * fica escondido, mas segue calculando `standbyRing`, onde a poeira se junta.
 */
export const ESTILO_ENXAME = 3

export function Core({ drive }: { drive: Drive }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const viewport = useThree((s) => s.viewport)

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#19c4c4') },
      // Not white — a tinted highlight keeps the hue readable once bloom
      // stacks on top, instead of washing the ring out to a grey band.
      uHot: { value: new THREE.Color('#c9fdff') },
      uLevel: { value: 0 },
      uPhase: { value: 0 },
      uOpen: { value: 0 },
      // Field scale, recomputed every frame from the viewport — see below.
      uZoom: { value: 1.2 },
      // Both of these are deliberately identities at their defaults: the ring
      // renders byte for byte as it did before they existed.
      uIntensity: { value: 1 },
      uStyle: { value: 0 },
    }),
    [],
  )

  useFrame((_, dt) => {
    if (!mat.current || !mesh.current) return
    const u = mat.current.uniforms
    const r = drive.reactor

    mesh.current.visible = r.visible && r.style !== ESTILO_ENXAME
    // Scaling the mesh rather than the shader's field. The ring sits at a fixed
    // radius inside a fixed quad with dark margin around it, so zooming the
    // field out would push the ring past the quad's own edge and cut it off in
    // a square; moving the quad takes the margin along with it.
    const s = drive.standby
    mesh.current.scale.setScalar(
      r.scale * THREE.MathUtils.lerp(1, STANDBY_SCALE * (0.985 + drive.pulse * 0.03), s),
    )

    const fit = Math.min(viewport.width, viewport.height)
    drive.standbyRing = FIT * 0.5 * fit * STANDBY_SCALE * r.scale
    u.uZoom.value = (RING_R * HALF) / (FIT * 0.5 * fit)
    u.uLevel.value += (drive.level - u.uLevel.value) * Math.min(1, dt * 8)
    // Accumulated, not derived from elapsed time scaled by level — scaling the
    // clock would rewrite all the turbulence that has already happened, and the
    // edge would boil harder the longer the tab had been open. The spin
    // multiplier rides on the same accumulator for the same reason.
    u.uPhase.value += dt * (0.5 + u.uLevel.value * 0.7) * r.spin * (1 - s * 0.85)
    u.uOpen.value += (drive.open - u.uOpen.value) * Math.min(1, dt * 1.6)
    u.uIntensity.value = r.intensity * THREE.MathUtils.lerp(1, 0.55 + drive.pulse * 0.45, s)
    u.uStyle.value = r.style
    ;(u.uColor.value as THREE.Color).lerp(r.color, Math.min(1, dt * 2.5))
  })

  return (
    <mesh ref={mesh} frustumCulled={false}>
      {/* One quad. The ring lives entirely in the fragment shader, so there is
          no geometry to tessellate and nothing to displace. */}
      <planeGeometry args={[5.4, 5.4]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={coreVertex}
        fragmentShader={coreFragment}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

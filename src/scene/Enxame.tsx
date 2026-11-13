import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'
import { ESTILO_ENXAME, FIT_DO_NUCLEO, STANDBY_SCALE } from './Core'
import { enxameVertex, particlesFragment, pontosDoEnxame } from './shaders'

/**
 * O núcleo do A.P.O.L.O.: o Enxame (ADR 0013 revisada, 12/11/2026).
 *
 * Uma esfera de pontos em faixas que giram em sentidos alternados, com um miolo
 * mais denso no centro. Obedece aos mesmos controles do anel que ele substituiu
 * (cor, escala, brilho, giro, visível) e à espera, que o encolhe e o deixa pulsar.
 * O anel, a esfera e o arame continuam como estilos que o agente pode pedir; aí é
 * o Core que aparece, e este some.
 */

const PONTOS = 2600
const PONTOS_DO_MIOLO = 220
/** O raio da esfera em relação ao do anel: ela tem volume, então cabe um pouco menor. */
const RAIO_RELATIVO = 0.9
const MIOLO_RELATIVO = 0.2

function criarCamada(quantos: number, tamanho: number) {
  const { positions, seeds } = pontosDoEnxame(quantos)
  const geometria = new THREE.BufferGeometry()
  geometria.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometria.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uAtivo: { value: 0 },
      uLevel: { value: 0 },
      uSize: { value: tamanho },
      uOpen: { value: 0 },
      uRaio: { value: 1 },
      uColor: { value: new THREE.Color('#19d8d2') },
      uIntensity: { value: 1 },
    },
    vertexShader: enxameVertex,
    fragmentShader: particlesFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const pontos = new THREE.Points(geometria, material)
  // A voz empurra os pontos para além do raio, e o recorte da câmera não sabe disso.
  pontos.frustumCulled = false
  return { pontos, material }
}

export function Enxame({ drive }: { drive: Drive }) {
  const grupo = useRef<THREE.Group>(null)
  const viewport = useThree((s) => s.viewport)
  const casca = useMemo(() => criarCamada(PONTOS, 2.2), [])
  const miolo = useMemo(() => criarCamada(PONTOS_DO_MIOLO, 3.0), [])

  useFrame((state, dt) => {
    if (!grupo.current) return
    const r = drive.reactor
    grupo.current.visible = r.visible && r.style === ESTILO_ENXAME
    if (!grupo.current.visible) return
    const s = drive.standby
    grupo.current.scale.setScalar(
      r.scale * THREE.MathUtils.lerp(1, STANDBY_SCALE * (0.985 + drive.pulse * 0.03), s),
    )
    const raio = FIT_DO_NUCLEO * 0.5 * Math.min(viewport.width, viewport.height) * RAIO_RELATIVO
    // Trabalhando é giro acima do de ouvir (1,1); pensar (2,8) e ferramenta (3,6) chegam perto de 1.
    const ativo = THREE.MathUtils.clamp((drive.spin - 1.2) / 2.2, 0, 1) * (1 - s)
    for (const [camada, fator, ritmo] of [[casca, 1, 1], [miolo, MIOLO_RELATIVO, -2.2]] as const) {
      const u = camada.material.uniforms
      u.uRaio.value = raio * fator
      u.uTime.value = state.clock.elapsedTime
      u.uLevel.value += (drive.level - u.uLevel.value) * Math.min(1, dt * 8)
      u.uAtivo.value += (ativo - u.uAtivo.value) * Math.min(1, dt * 2)
      // Acumulado, como o anel: a espera quase para o giro, e ele retoma de onde estava.
      u.uPhase.value += dt * (0.35 + u.uLevel.value * 0.6) * drive.spin * r.spin * ritmo * (1 - s * 0.85)
      u.uOpen.value += (drive.open - u.uOpen.value) * Math.min(1, dt * 1.6)
      u.uIntensity.value = r.intensity * THREE.MathUtils.lerp(1, 0.55 + drive.pulse * 0.45, s)
      ;(u.uColor.value as THREE.Color).lerp(r.color, Math.min(1, dt * 2.5))
    }
  })

  return (
    <group ref={grupo}>
      <primitive object={casca.pontos} />
      <primitive object={miolo.pontos} />
    </group>
  )
}

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'
import { particlesFragment, particlesVertex } from './shaders'

/**
 * A shell of points around the core. Each one drifts on its own orbit and gets
 * pushed outward by loudness, so the whole cloud expands when JARVIS speaks.
 */

const COUNT = 4000

export function Particles({ drive }: { drive: Drive }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const pts = useRef<THREE.Points>(null)

  const { positions, seeds, radii } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const seeds = new Float32Array(COUNT)
    const radii = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      // Even distribution on a sphere, then jittered into a shell.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const radius = 1.9 + Math.pow(Math.random(), 2) * 2.6
      positions[i * 3] = Math.cos(theta) * r * radius
      positions[i * 3 + 1] = u * radius
      positions[i * 3 + 2] = Math.sin(theta) * r * radius
      seeds[i] = Math.random()
      radii[i] = (radius - 1.9) / 2.6
    }
    return { positions, seeds, radii }
  }, [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uSize: { value: 3.4 },
      uStandby: { value: 0 },
      uRing: { value: 1 },
      uColor: { value: new THREE.Color('#00e5ff') },
      uIntensity: { value: 1 },
    }),
    [],
  )

  useFrame((_, dt) => {
    if (!mat.current || !pts.current) return
    const u = mat.current.uniforms
    pts.current.visible = drive.reactor.visible
    u.uIntensity.value = drive.reactor.intensity
    // Acumulado, não o relógio: é assim que as órbitas param em espera e retomam
    // de onde estavam, sem um salto.
    u.uTime.value += dt * (1 - drive.standby)
    u.uStandby.value = drive.standby
    u.uRing.value = drive.standbyRing
    u.uLevel.value += (drive.level - u.uLevel.value) * Math.min(1, dt * 6)
    ;(u.uColor.value as THREE.Color).lerp(drive.color, Math.min(1, dt * 3))
  })

  // Culling is off for the same reason as the core: loudness pushes the shell out
  // past its authored radius.
  return (
    <points ref={pts} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aRadius" args={[radii, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={particlesVertex}
        fragmentShader={particlesFragment}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

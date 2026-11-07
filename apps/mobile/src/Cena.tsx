import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native'
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl'
import * as THREE from 'three'
import {
  coreFragment,
  coreVertex,
  particlesFragment,
  particlesOrbitVertex,
} from '../../../src/scene/shaders'
import { COR_DE_FUNDO, CORES, type Fase } from './tema'

/** O que a tela muda sem passar pelo React, uma vez por quadro. */
export type Motor = {
  fase: Fase
  /** 0..1: segue a voz de quem estiver falando e decai sozinho no silêncio. */
  nivel: number
}

/**
 * Desenha com menos pontos por lado e amplia. O shader do círculo roda por
 * pixel, e em 3x seriam quase 4 milhões deles; ampliar também suaviza o traço, o
 * que aqui faz as vezes do bloom da versão web.
 */
const REDUCAO = 2
/** 30 quadros por segundo: o círculo é fundo de tela, não vale a bateria de 60. */
const INTERVALO_MS = 30

const COUNT = 1800
const HALF = 2.7
const RING_R = 0.74
/** Fração da largura ocupada pelo círculo. */
const FIT = 0.62
/** O quanto o círculo sobe e desce, em unidades da cena: flutua, não treme. */
const FLUTUACAO = 0.07
/** A nuvem se alonga na vertical, onde a tela em pé tem espaço. */
const ALTURA_DA_NUVEM = 1.4
/** Quanto o círculo inteiro cresce com a voz. O shader sozinho mexe só 3% da borda. */
const PULSO_DO_CIRCULO = 0.13

const giroPorFase: Record<Fase, number> = {
  offline: 0.08,
  espera: 0.25,
  ocioso: 1.1,
  ouvindo: 1.5,
  processando: 2.8,
  executando: 3.6,
  codificando: 3.6,
  falando: 1.4,
}

/** Voltas das partículas, em radianos por segundo. Ouvir já é mais vivo que repousar. */
const orbitaPorFase: Record<Fase, number> = {
  offline: 0.04,
  espera: 0.06,
  ocioso: 0.16,
  ouvindo: 0.24,
  processando: 0.75,
  executando: 1,
  codificando: 1,
  falando: 0.3,
}

function criarRenderer(gl: ExpoWebGLRenderingContext) {
  const { drawingBufferWidth: width, drawingBufferHeight: height } = gl
  // O three só precisa de um canvas para ler o tamanho e pedir o contexto.
  const canvas = {
    width,
    height,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext: () => gl,
  }
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    context: gl as unknown as WebGL2RenderingContext,
    antialias: false,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.setClearColor(COR_DE_FUNDO, 1)
  return renderer
}

function criarCirculo() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(CORES.offline) },
      uHot: { value: new THREE.Color('#c9fdff') },
      uLevel: { value: 0 },
      uPhase: { value: 0 },
      uOpen: { value: 0 },
      uZoom: { value: 1.2 },
      uIntensity: { value: 1 },
      uStyle: { value: 0 },
    },
    vertexShader: coreVertex,
    fragmentShader: coreFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const malha = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), material)
  malha.frustumCulled = false
  return { malha, material }
}

function criarParticulas(raioDoCirculo: number) {
  const positions = new Float32Array(COUNT * 3)
  const seeds = new Float32Array(COUNT)
  const radii = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    const angulo = Math.random() * Math.PI * 2
    positions[i * 3] = Math.cos(angulo)
    positions[i * 3 + 1] = Math.sin(angulo)
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5
    seeds[i] = Math.random()
    // Ao quadrado: a maioria fica perto do círculo, e o resto se dissolve para fora.
    radii[i] = Math.pow(Math.random(), 2)
  }
  const geometria = new THREE.BufferGeometry()
  geometria.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometria.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  geometria.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uSize: { value: 2.4 },
      uStandby: { value: 0 },
      uRing: { value: raioDoCirculo },
      uSpin: { value: 0 },
      uTall: { value: ALTURA_DA_NUVEM },
      uColor: { value: new THREE.Color(CORES.offline) },
      uIntensity: { value: 1 },
    },
    vertexShader: particlesOrbitVertex,
    fragmentShader: particlesFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const pontos = new THREE.Points(geometria, material)
  pontos.frustumCulled = false
  return { pontos, material }
}

export function Cena({ motor }: { motor: RefObject<Motor> }) {
  const { width, height } = useWindowDimensions()
  const parar = useRef<() => void>(() => {})
  useEffect(() => () => parar.current(), [])

  const estilo = useMemo(() => {
    const largura = Math.ceil(width / REDUCAO)
    const altura = Math.ceil(height / REDUCAO)
    return {
      position: 'absolute' as const,
      width: largura,
      height: altura,
      left: (width - largura) / 2,
      top: (height - altura) / 2,
      transform: [{ scale: REDUCAO }],
    }
  }, [width, height])

  const aoCriarContexto = (gl: ExpoWebGLRenderingContext) => {
    const renderer = criarRenderer(gl)
    const cena = new THREE.Scene()
    const aspecto = gl.drawingBufferWidth / gl.drawingBufferHeight
    const camera = new THREE.PerspectiveCamera(45, aspecto, 0.1, 100)
    camera.position.z = 6.2

    const alturaVisivel = 2 * 6.2 * Math.tan(THREE.MathUtils.degToRad(22.5))
    const menorLado = Math.min(alturaVisivel, alturaVisivel * aspecto)
    const raioDoCirculo = FIT * 0.5 * menorLado

    const circulo = criarCirculo()
    const particulas = criarParticulas(raioDoCirculo)
    cena.add(circulo.malha, particulas.pontos)
    circulo.material.uniforms.uZoom.value = (RING_R * HALF) / raioDoCirculo

    const alvo = new THREE.Color()
    let quadro = 0
    let anterior = 0
    let relogio = 0
    let ativo = true

    const desenhar = (agora: number) => {
      if (!ativo) return
      quadro = requestAnimationFrame(desenhar)
      if (AppState.currentState !== 'active') return
      if (anterior && agora - anterior < INTERVALO_MS) return
      const dt = anterior ? Math.min((agora - anterior) / 1000, 0.1) : 0.016
      anterior = agora
      relogio += dt

      const { fase } = motor.current
      motor.current.nivel *= Math.exp(-dt * 2.4)
      const respiro = (Math.sin(relogio * 0.9) * 0.5 + 0.5) * (fase === 'offline' ? 0.02 : 0.12)
      const nivel = Math.max(motor.current.nivel, respiro)

      const u = circulo.material.uniforms
      const p = particulas.material.uniforms
      alvo.set(CORES[fase])
      u.uLevel.value += (nivel - u.uLevel.value) * Math.min(1, dt * 8)
      p.uLevel.value += (nivel - p.uLevel.value) * Math.min(1, dt * 9)
      u.uPhase.value += dt * (0.5 + u.uLevel.value * 2.2) * giroPorFase[fase]
      p.uTime.value = relogio
      // Acumulado, como uPhase: mudar de fase muda a velocidade, sem salto na posição.
      p.uSpin.value += dt * (orbitaPorFase[fase] + p.uLevel.value * 0.9)
      const repouso = fase === 'espera' || fase === 'offline' ? 1 : 0
      p.uStandby.value += (repouso - p.uStandby.value) * Math.min(1, dt * 1.8)
      circulo.malha.scale.setScalar(1 + u.uLevel.value * PULSO_DO_CIRCULO)
      const abertura = fase === 'offline' ? 0.7 : 1.6
      u.uOpen.value += (abertura - u.uOpen.value) * Math.min(1, dt * 1.6)
      u.uColor.value.lerp(alvo, Math.min(1, dt * 2.5))
      p.uColor.value.lerp(alvo, Math.min(1, dt * 3))

      const flutuacao = Math.sin(relogio * 0.7) * FLUTUACAO
      circulo.malha.position.y = flutuacao
      particulas.pontos.position.y = flutuacao

      camera.position.x = Math.sin(relogio * 0.13) * 0.08
      camera.position.y = Math.cos(relogio * 0.17) * 0.08
      camera.lookAt(0, 0, 0)

      renderer.render(cena, camera)
      gl.endFrameEXP()
      // Espera o GL terminar. O expo-gl enfileira os comandos em outra thread, e o
      // flush não bloqueia: só uma leitura síncrona como esta impede que, num
      // aparelho sobrecarregado, os quadros se acumulem e a tela fique para trás.
      // Nunca fora de primeiro plano: ali o expo-gl ignora o flush, e esta leitura
      // congelaria o JavaScript até o app voltar.
      if (AppState.currentState === 'active') gl.getError()
    }

    // O iOS encerra quem usa a GPU em segundo plano, então o laço para antes.
    const aoMudarDeEstado = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && !ativo) {
        ativo = true
        anterior = 0
        quadro = requestAnimationFrame(desenhar)
      } else if (estado !== 'active') {
        ativo = false
        cancelAnimationFrame(quadro)
      }
    })

    parar.current = () => {
      ativo = false
      cancelAnimationFrame(quadro)
      aoMudarDeEstado.remove()
      renderer.dispose()
    }
    quadro = requestAnimationFrame(desenhar)
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <GLView style={estilo} onContextCreate={aoCriarContexto} />
    </View>
  )
}

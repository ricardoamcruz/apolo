/**
 * A.T.L.A.S., o globo de pontos (extensão plugável, docs/adr/0033).
 *
 * O núcleo vira o globo: os pontos nascem espalhados numa esfera do tamanho do
 * Enxame, girando nas faixas dele, e escorregam pelas latitudes até pousar nos
 * continentes. Ao fechar, fazem o caminho de volta e o Enxame reaparece.
 *
 * Marca cidades, coordenadas e listas de lugares. Um lugar só: zoom pelo tamanho
 * dele, sem perder o entorno. Vários: a menor distância que mostra todos. Espalhados
 * pelo mundo: o globo inteiro, centrado no meio deles.
 *
 * Cores: o globo na cor da interface, os marcadores na contrastante (a mesma do
 * alerta). Sem botões: voz, mouse e toque.
 *
 * Perto do chão, a camada de cidade: abaixo de uns 280 km de raio, rodovias e litoral;
 * mais perto, avenidas, rios e parques (e, abaixo de uns 16 km, as ruas de bairro) viram pontos que descem e se
 * assentam, com os nomes dos bairros. Vêm dos blocos vetoriais do OpenFreeMap (dados
 * do OpenStreetMap), decodificados num Web Worker e guardados no cache do navegador.
 * Marcadores juntos demais na tela viram um grupo com a contagem.
 *
 * A localização do Ricardo, só quando ele pede: um ponto na terceira cor, que fica na
 * tela e não sai da máquina (a resposta à voz não leva a coordenada).
 *
 * Um arquivo só, sem import: o A.P.O.L.O. entrega o three.js e o resto por `apolo`.
 * As coordenadas vêm do OpenStreetMap (Nominatim, que acerta capitais e devolve
 * nomes em português; Photon de reserva), com cache.
 */

const FOV = 38
const R_TERRA = 6371008.8
/** Uns 700 m acima do chão: quarteirões inteiros na tela. */
const DMIN = 1 + 700 / R_TERRA
const DMAX = 6
/** Abaixo deste raio na tela (km), a cidade se monta; entre ele e o seguinte, ela some aos poucos. */
const CIDADE_KM = 200
const CIDADE_SOME_KM = 280
/** Os blocos vetoriais: o índice diz o endereço da versão atual. */
const BLOCOS = 'https://tiles.openfreemap.org/planet'
const MAX_BLOCOS_NO_CACHE = 1500
/** Distância na tela (px) abaixo da qual marcadores viram um grupo. */
const JUNTOS_PX = 40
const OURO = Math.PI * (3 - Math.sqrt(5))
/** Quanto do mar aparece: um ponto a cada tantos da esfera leve. */
const PASSO_DO_MAR = 11
const MAX_LOCAIS = 25
/** O raio da calota mostrada para um lugar só, por tipo, quando a busca não diz o tamanho. */
const CONTEXTO = { cidade: 6, estado: 9, pais: 16, lugar: 0.025, coordenada: 6, voce: 0.03 }
const CAMADA_DA_BUSCA = { cidade: 'city', estado: 'state', pais: 'country' }

export async function ativar(apolo) {
  const THREE = apolo.THREE
  const rad = THREE.MathUtils.degToRad
  const deg = THREE.MathUtils.radToDeg
  const clamp = THREE.MathUtils.clamp

  // Convenção: lat 0 / lon 0 olha para +z; norte é +y.
  const vetor = (lat, lon) =>
    new THREE.Vector3(Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon)))
  const latLon = (v) => ({ lat: deg(Math.asin(clamp(v.y, -1, 1))), lon: deg(Math.atan2(v.x, v.z)) })

  /* ------------------------------------------------------------ a tela */

  const camada = apolo.camada()
  camada.classList.add('atlas')
  const estilo = document.createElement('style')
  estilo.textContent = CSS
  camada.append(estilo)
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  const tela = renderer.domElement
  tela.className = 'atlas-tela'
  camada.append(tela)
  const rotulos = div('atlas-rotulos')
  const leitura = div('atlas-leitura')
  camada.append(rotulos, leitura)

  const scene = new THREE.Scene()
  // O plano de corte acompanha a altura (no laço): perto do chão, ele chega a centímetros.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1e-6, 50)
  const globo = new THREE.Group()
  scene.add(globo)

  /* --------------------------------------------------------- os pontos */

  const dados = new Uint8Array(await (await fetch(apolo.arquivo('terra.bin'))).arrayBuffer())
  if (String.fromCharCode(...dados.slice(0, 4)) !== 'ATL1') throw new Error('terra.bin em formato desconhecido')
  const visao = new DataView(dados.buffer)
  const n1 = visao.getUint32(4, true)
  const n2 = visao.getUint32(8, true)
  const b1 = Math.ceil(n1 / 8)
  const b2 = Math.ceil(n2 / 8)
  const terra1 = dados.subarray(12, 12 + b1)
  const costa1 = dados.subarray(12 + b1, 12 + 2 * b1)
  const terra2 = dados.subarray(12 + 2 * b1, 12 + 2 * b1 + b2)
  const costa2 = dados.subarray(12 + 2 * b1 + b2, 12 + 2 * b1 + 2 * b2)
  const tem = (m, i) => (m[i >> 3] >> (i & 7)) & 1

  /** O ponto i da esfera de Fibonacci de n pontos: a mesma conta do gerador. */
  const pontoDaEsfera = (i, n, saida, k) => {
    const lat = Math.asin(1 - ((i + 0.5) / n) * 2)
    const lon = rad(((((i * OURO * 180) / Math.PI) % 360) + 540) % 360 - 180)
    saida[k] = Math.cos(lat) * Math.sin(lon)
    saida[k + 1] = Math.sin(lat)
    saida[k + 2] = Math.cos(lat) * Math.cos(lon)
  }

  /**
   * Uma camada de pontos. `aInicio` diz de onde o ponto sai na abertura: uma
   * latitude qualquer e um desvio de longitude. Sorteados assim, os pontos começam
   * cobrindo a esfera por igual, como o Enxame, e chegam deslizando pelas faixas.
   */
  function camadaDePontos(n, escolher, ehCosta) {
    const indices = []
    for (let i = 0; i < n; i++) if (escolher(i)) indices.push(i)
    const pos = new Float32Array(indices.length * 3)
    const inicio = new Float32Array(indices.length * 2)
    const seed = new Float32Array(indices.length)
    const costa = new Float32Array(indices.length)
    indices.forEach((i, k) => {
      pontoDaEsfera(i, n, pos, k * 3)
      inicio[k * 2] = Math.asin(Math.random() * 2 - 1)
      inicio[k * 2 + 1] = (Math.random() * 2 - 1) * Math.PI * 0.75
      seed[k] = Math.random()
      costa[k] = ehCosta ? ehCosta(i) : 0
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aInicio', new THREE.BufferAttribute(inicio, 2))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.setAttribute('aCosta', new THREE.BufferAttribute(costa, 1))
    return g
  }

  const material = (tamanho) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMontagem: { value: 0 },
        uGiro: { value: 0 },
        uColor: { value: new THREE.Color(apolo.cor.interface()) },
        uSize: { value: 1 },
        uAlfa: { value: 1 },
        uFundo: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    m.userData.tamanho = tamanho
    return m
  }
  const matTerra = material(0.0058)
  const matMar = material(0.0034)
  const matPerto = material(0.0026)
  const materiais = [matTerra, matMar, matPerto]

  // Montar as camadas leva um instante (são 225 mil pontos): fica para depois da partida.
  // Com prazo: a cena do A.P.O.L.O. desenha sem parar, e sem ele a folga pode nunca vir.
  await new Promise((pronto) => {
    window.requestIdleCallback?.(() => pronto())
    setTimeout(pronto, 1500)
  })
  const pontosTerra = new THREE.Points(camadaDePontos(n1, (i) => tem(terra1, i), (i) => tem(costa1, i)), matTerra)
  const pontosMar = new THREE.Points(camadaDePontos(n1, (i) => !tem(terra1, i) && i % PASSO_DO_MAR === 0), matMar)
  const pontosPerto = new THREE.Points(camadaDePontos(n2, (i) => tem(terra2, i), (i) => tem(costa2, i)), matPerto)
  for (const p of [pontosTerra, pontosMar, pontosPerto]) p.frustumCulled = false
  globo.add(pontosMar, pontosTerra, pontosPerto)

  // O aro de Fresnel: a borda do globo mesmo onde só há mar.
  const matAr = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(apolo.cor.interface()) }, uAlfa: { value: 0 } },
    vertexShader: `varying vec3 vN, vV; void main(){ vec4 m = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-m.xyz); gl_Position = projectionMatrix * m; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlfa; varying vec3 vN, vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(uColor, f * 0.5 * uAlfa); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const ar = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 64), matAr)
  scene.add(ar)

  /* ------------------------------------------------------------- cores */

  // Três cores: o globo na da interface, os marcadores na contrastante e a localização
  // dele na terceira (src/lib/cor.ts). Azul, vermelho e amarelo, quando a interface é azul.
  const cor = {
    interface: new THREE.Color(apolo.cor.interface()),
    contraste: new THREE.Color(apolo.cor.contrastante()),
    terceira: new THREE.Color(apolo.cor.terceira()),
  }
  const alvoDaCor = { interface: cor.interface.clone(), contraste: cor.contraste.clone(), terceira: cor.terceira.clone() }
  apolo.cor.ouvir((interfaceHex, contrasteHex, terceiraHex) => {
    alvoDaCor.interface.set(interfaceHex)
    alvoDaCor.contraste.set(contrasteHex)
    alvoDaCor.terceira.set(terceiraHex)
    camada.style.setProperty('--atlas-cor', interfaceHex)
    camada.style.setProperty('--atlas-contraste', contrasteHex)
    camada.style.setProperty('--atlas-terceira', terceiraHex)
  })

  /* ------------------------------------------------ a camada de cidade
   * Os blocos vetoriais viram pontos num Web Worker (processarBloco, no fim do
   * arquivo), para a animação não engasgar. Os pontos ficam num plano preso a uma
   * âncora (o centro da região), em raios da Terra relativos a ela: a precisão é a do
   * centímetro, e não a de um número de 32 bits no raio da Terra.
   */
  const trabalhadorUrl = URL.createObjectURL(new Blob([codigoDoTrabalhador()], { type: 'text/javascript' }))
  const trabalhador = new Worker(trabalhadorUrl)
  let proximoPedido = 0
  const pendentes = new Map()
  trabalhador.onmessage = (e) => {
    const pronto = pendentes.get(e.data.id)
    pendentes.delete(e.data.id)
    pronto?.(e.data)
  }
  const decodificar = (buf, p) =>
    new Promise((pronto) => {
      const id = ++proximoPedido
      pendentes.set(id, pronto)
      trabalhador.postMessage({ id, buf, p }, [buf])
    })

  /** O endereço dos blocos da versão atual, guardado por um dia. */
  let modeloDosBlocos = null
  async function enderecoDosBlocos() {
    if (modeloDosBlocos) return modeloDosBlocos
    try {
      const salvo = JSON.parse(localStorage.getItem('atlas:blocos') || 'null')
      if (salvo && Date.now() - salvo.em < 86_400_000) return (modeloDosBlocos = salvo.url)
    } catch {
      /* sem armazenamento: pede de novo */
    }
    const indice = await pedirJson(BLOCOS)
    modeloDosBlocos = indice.tiles[0]
    try {
      localStorage.setItem('atlas:blocos', JSON.stringify({ url: modeloDosBlocos, em: Date.now() }))
    } catch {
      /* só não guarda */
    }
    return modeloDosBlocos
  }

  // O mais rápido que existe é não baixar: cada bloco fica no cache do navegador.
  const caixa = typeof caches === 'undefined' ? Promise.resolve(null) : caches.open('atlas-blocos-v1').catch(() => null)
  let guardadosDesdeALimpeza = 0
  async function baixarBloco(z, x, y) {
    const url = (await enderecoDosBlocos()).replace('{z}', z).replace('{x}', x).replace('{y}', y)
    const c = await caixa
    const guardado = c ? await c.match(url).catch(() => null) : null
    if (guardado) return guardado.arrayBuffer()
    const r = await fetch(url)
    if (r.status === 404) {
      // A versão mudou: o índice novo traz o endereço novo.
      modeloDosBlocos = null
      try {
        localStorage.removeItem('atlas:blocos')
      } catch {
        /* nada */
      }
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    if (c) {
      c.put(url, r.clone()).catch(() => {})
      if (++guardadosDesdeALimpeza >= 50) {
        guardadosDesdeALimpeza = 0
        c.keys()
          .then((chaves) => Promise.all(chaves.slice(0, Math.max(0, chaves.length - MAX_BLOCOS_NO_CACHE)).map((k) => c.delete(k))))
          .catch(() => {})
      }
    }
    return r.arrayBuffer()
  }

  const ancora = new THREE.Group()
  globo.add(ancora)
  let ancoraVetor = null
  let base = null
  let geracao = 0
  function ancorar(lat, lon) {
    limparBlocos()
    const v = vetor(lat, lon)
    const leste = new THREE.Vector3(0, 1, 0).cross(v).normalize()
    const norte = v.clone().cross(leste).normalize()
    ancora.position.copy(v)
    ancora.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(leste, norte, v))
    ancoraVetor = v
    base = [leste.x, leste.y, leste.z, norte.x, norte.y, norte.z, v.x, v.y, v.z]
  }

  /** chave "z/x/y" → { z, x, y, pontos, material, lugares, chegada, alfa, saindo } */
  const blocos = new Map()
  const fila = []
  let baixando = 0
  let zAtual = 0
  let zMudouEm = 0
  let pxPorUnidade = 1
  let falhasDeBloco = 0

  function pedirBloco(z, x, y, escala) {
    const chave = `${z}/${x}/${y}`
    const existente = blocos.get(chave)
    if (existente) {
      existente.saindo = false
      return
    }
    const bloco = { chave, z, x, y, pontos: null, material: null, lugares: [], chegada: 0, alfa: 1, saindo: false, escala }
    blocos.set(chave, bloco)
    fila.push(bloco)
  }

  function andarFila() {
    while (baixando < 6 && fila.length) {
      const bloco = fila.shift()
      if (blocos.get(bloco.chave) !== bloco || bloco.saindo) continue
      baixando++
      const minhaGeracao = geracao
      const ancoraAgora = [ancoraVetor.x, ancoraVetor.y, ancoraVetor.z]
      baixarBloco(bloco.z, bloco.x, bloco.y)
        .then((buf) => decodificar(buf, { z: bloco.z, x: bloco.x, y: bloco.y, ancora: ancoraAgora, base }))
        .then((resposta) => {
          if (resposta.erro) throw new Error(resposta.erro)
          if (minhaGeracao !== geracao || blocos.get(bloco.chave) !== bloco) return
          montarBloco(bloco, resposta.r)
          falhasDeBloco = 0
        })
        .catch((err) => {
          falhasDeBloco++
          apolo.log(`bloco ${bloco.chave} não veio: ${err?.message ?? err}`)
          if (blocos.get(bloco.chave) === bloco) blocos.delete(bloco.chave)
        })
        .finally(() => {
          baixando--
        })
    }
  }

  function montarBloco(bloco, r) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3))
    g.setAttribute('aClasse', new THREE.BufferAttribute(r.cls, 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(r.seed, 1))
    const metrosDoBloco = (2 * Math.PI * R_TERRA * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - (2 * (bloco.y + 0.5)) / 2 ** bloco.z))))) / 2 ** bloco.z
    const tamanho = (metrosDoBloco / 170) * 0.55 / R_TERRA
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: cor.interface },
        uTamanho: { value: tamanho },
        uSize: { value: tamanho * pxPorUnidade },
        uChegada: { value: 0 },
        uEscala: { value: bloco.escala },
        uAlfa: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: VERTEX_CIDADE,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const pontos = new THREE.Points(g, material)
    pontos.frustumCulled = false
    ancora.add(pontos)
    bloco.pontos = pontos
    bloco.material = material
    bloco.lugares = r.lugares.map((l) => ({ ...l, v: vetor(l.lat, l.lon) }))
  }

  function removerBloco(bloco) {
    if (bloco.pontos) {
      ancora.remove(bloco.pontos)
      bloco.pontos.geometry.dispose()
      bloco.material.dispose()
    }
    blocos.delete(bloco.chave)
  }
  function limparBlocos() {
    geracao++
    fila.length = 0
    for (const b of [...blocos.values()]) removerBloco(b)
  }

  /** Os blocos que cobrem a tela agora, no zoom em que o detalhe faz sentido. */
  function escolherBlocos(km) {
    // Do zoom 8 (rodovias e litoral, a ~280 km) ao 14 (cada rua, a ~1 km).
    const z = clamp(Math.floor(Math.log2((40075 * Math.cos(rad(vista.lat))) / Math.max(0.3, km * 0.5))), 8, 14)
    if (z !== zAtual) {
      zAtual = z
      zMudouEm = relogio
    }
    const n = 2 ** z
    const dLat = (km * 1.2) / 111.32
    const dLon = (km * 1.2 * Math.max(1, camera.aspect)) / (111.32 * Math.max(0.2, Math.cos(rad(vista.lat))))
    const blocoX = (lon) => Math.floor((((lon + 180) % 360) + 360) % 360 / 360 * n)
    const blocoY = (lat) => {
      const l = rad(clamp(lat, -85, 85))
      return clamp(Math.floor(((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n), 0, n - 1)
    }
    const x0 = blocoX(vista.lon - dLon)
    const x1 = blocoX(vista.lon + dLon)
    const y0 = blocoY(vista.lat + dLat)
    const y1 = blocoY(vista.lat - dLat)
    const largura = ((x1 - x0 + n) % n) + 1
    // A altura de onde os pontos descem, na escala do que está na tela.
    const escala = (km * 1000 * 0.12) / R_TERRA
    const precisa = new Set()
    for (let dx = 0; dx < largura && dx < 12; dx++) {
      for (let y = y0; y <= y1 && y - y0 < 10; y++) {
        const x = (x0 + dx) % n
        precisa.add(`${z}/${x}/${y}`)
        pedirBloco(z, x, y, escala)
      }
    }
    // Do centro para fora: o que ele está olhando chega primeiro.
    const meioX = blocoX(vista.lon)
    const meioY = blocoY(vista.lat)
    fila.sort((a, b) => Math.hypot(a.x - meioX, a.y - meioY) - Math.hypot(b.x - meioX, b.y - meioY))
    // O zoom anterior só sai quando o novo cobriu a tela (ou demorou): sem buracos.
    const prontos = [...precisa].filter((k) => blocos.get(k)?.pontos).length
    const cobriu = prontos >= precisa.size * 0.8 || relogio - zMudouEm > 2.5
    for (const b of blocos.values()) {
      if (precisa.has(b.chave)) continue
      if (!b.pontos) blocos.delete(b.chave)
      else if (b.z === z || cobriu) b.saindo = true
    }
  }

  /* ------------------------------------------------------------ câmera */

  // O estado é o ponto no meio da tela e a distância ao centro do globo (raio 1).
  const vista = { lat: -15, lon: -50, d: 3 }
  const meiaVisao = () => {
    const v = rad(FOV / 2)
    return Math.min(v, Math.atan(Math.tan(v) * camera.aspect))
  }
  /** O globo inteiro, solto no meio da tela, com folga em volta: ele flutua. */
  const dGlobo = () => 1.34 / Math.sin(meiaVisao() * 0.86)
  /** A distância em que o globo tem o tamanho do Enxame: é dali que ele nasce. */
  const dDoNucleo = () => {
    const raio = Math.max(20, apolo.nucleo.geometria().raio)
    const a = Math.atan((raio * 2 * Math.tan(rad(FOV / 2))) / Math.max(1, camada.clientHeight))
    return clamp(1 / Math.sin(a), 1.5, 40)
  }
  /** A menor distância em que uma calota de raio angular θ cabe na tela, com margem para os rótulos. */
  function distanciaPara(theta) {
    if (theta > rad(72)) return dGlobo()
    const phi = meiaVisao() * 0.8
    return clamp(Math.cos(theta) + Math.sin(theta) / Math.tan(phi), DMIN, dGlobo())
  }

  function enquadrar(locais) {
    if (!locais.length) return { lat: vista.lat, lon: vista.lon, d: dGlobo() }
    const vs = locais.map((l) => vetor(l.lat, l.lon))
    const soma = vs.reduce((a, v) => a.add(v), new THREE.Vector3())
    const centro = soma.length() < 1e-3 ? vs[0].clone() : soma.normalize()
    let theta
    if (vs.length === 1) theta = rad(locais[0].contexto ?? CONTEXTO.cidade)
    else {
      const maior = Math.max(...vs.map((v) => v.angleTo(centro)))
      // Com a camada de cidade, dá para chegar a uns 600 m: cafeterias vizinhas se separam.
      theta = Math.max(maior * 1.25 + Math.min(rad(1.2), maior * 0.3), 600 / R_TERRA)
    }
    return { ...latLon(centro), d: distanciaPara(theta) }
  }

  /**
   * O voo: arco de grande círculo, com um afastamento proporcional ao caminho. Perto,
   * quase não sai do chão; do outro lado do mundo, sobe até ver o globo inteiro.
   */
  let voo = null
  function voar(alvo) {
    const a = vetor(vista.lat, vista.lon)
    const b = vetor(alvo.lat, alvo.lon)
    const ang = a.angleTo(b)
    const maior = Math.max(vista.d, alvo.d)
    const pico = maior + (dGlobo() - maior) * Math.min(1, ang / rad(55)) * 0.9
    // Na escala da altura sobre o chão, em logaritmo: de 10.000 km a 1 km são sete
    // ordens de grandeza, e o voo tem de andar igual por todas.
    const h0 = Math.log(vista.d - 1)
    const h1 = Math.log(alvo.d - 1)
    voo = { a, b, ang, h0, h1, pico: Math.log(Math.max(pico, maior) - 1), t: 0, dur: 1.1 + (ang / Math.PI) * 1.9 + Math.abs(h1 - h0) * 0.12 }
    inercia.x = inercia.y = 0
  }
  const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
  function passoDoVoo(dt) {
    if (!voo) return
    voo.t = Math.min(1, voo.t + dt / voo.dur)
    const e = suave(voo.t)
    const v =
      voo.ang < 1e-4
        ? voo.b.clone()
        : voo.a.clone().multiplyScalar(Math.sin((1 - e) * voo.ang)).add(voo.b.clone().multiplyScalar(Math.sin(e * voo.ang))).divideScalar(Math.sin(voo.ang))
    Object.assign(vista, latLon(v))
    // Só sobe além da mais alta das pontas quando o caminho pede (um voo longo).
    const subida = Math.max(0, voo.pico - Math.max(voo.h0, voo.h1))
    vista.d = 1 + Math.exp(THREE.MathUtils.lerp(voo.h0, voo.h1, e) + subida * Math.sin(Math.PI * voo.t))
    if (voo.t >= 1) voo = null
  }

  /* --------------------------------------------- o farol (marcador) */

  const marcadores = []
  const disco = new THREE.CircleGeometry(0.0075, 24)
  const aro = new THREE.RingGeometry(0.02, 0.023, 48)
  const feixe = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.16)])
  const cheio = () =>
    new THREE.MeshBasicMaterial({ color: cor.contraste, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })

  function farol() {
    const g = new THREE.Group()
    const nucleo = new THREE.Mesh(disco, cheio())
    const anel = new THREE.Mesh(aro, cheio())
    const linha = new THREE.Line(
      feixe,
      new THREE.LineBasicMaterial({ color: cor.contraste, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    g.add(nucleo, anel, linha)
    g.userData.materiais = [nucleo.material, anel.material, linha.material]
    g.userData.anima = (t, s) => {
      const k = (t * 0.6 + s) % 1
      anel.scale.setScalar(0.4 + k * 1.6)
      anel.material.opacity = (1 - k) * 0.9
    }
    return g
  }

  const fmt = (x, pos, neg, casas = 2) => `${Math.abs(x).toFixed(casas).replace('.', ',')}°${x >= 0 ? pos : neg}`

  function acrescentar(locais) {
    locais.forEach((l, i) => {
      const raiz = new THREE.Group()
      const v = vetor(l.lat, l.lon)
      raiz.position.copy(v)
      raiz.lookAt(v.clone().multiplyScalar(2))
      const visual = farol()
      raiz.add(visual)
      globo.add(raiz)
      const el = div('atlas-rotulo')
      rotulos.append(el)
      marcadores.push({ ...l, raiz, visual, el, nasce: relogio + 0.35 + i * 0.09, seed: Math.random() })
    })
    numerar()
  }
  function numerar() {
    const varios = marcadores.length > 1
    marcadores.forEach((m, i) => {
      m.el.innerHTML = ''
      if (varios) m.el.append(span('atlas-num', String(i + 1).padStart(2, '0')))
      // "Coliseu, Roma" vira "Coliseu": o resto da frase era para a busca.
      m.el.append(document.createTextNode(m.nome.split(',')[0].trim()))
      // Quatro casas: de perto, duas casas deixam cafeterias vizinhas com o mesmo número.
      m.el.append(span('atlas-coord', `${fmt(m.lat, 'N', 'S', 4)} ${fmt(m.lon, 'L', 'O', 4)}`))
    })
  }
  function limparMarcadores() {
    for (const m of marcadores.splice(0)) {
      globo.remove(m.raiz)
      m.visual.userData.materiais.forEach((mt) => mt.dispose())
      m.el.remove()
    }
    categoria = ''
  }
  /** O que os marcadores são, para o rótulo do grupo ("5 cafeterias"). */
  let categoria = ''

  /** Os rótulos de grupo, reaproveitados de um quadro para o outro. */
  const rotulosDeGrupo = []
  const rotuloDeGrupo = (k) => {
    while (rotulosDeGrupo.length <= k) {
      const el = div('atlas-rotulo atlas-grupo')
      rotulos.append(el)
      rotulosDeGrupo.push(el)
    }
    return rotulosDeGrupo[k]
  }

  /* --------------------------------------- a localização dele */
  // Só quando ele pede: um ponto na terceira cor, com o círculo da precisão no chão.
  let voce = null
  const discoVoce = new THREE.CircleGeometry(0.0095, 32)
  const halo = new THREE.RingGeometry(0.012, 0.0155, 48)
  const precisaoAro = new THREE.RingGeometry(0.985, 1, 96)
  function mostrarVoce({ lat, lon, precisao }) {
    esconderVoce()
    const raiz = new THREE.Group()
    const v = vetor(lat, lon)
    raiz.position.copy(v)
    raiz.lookAt(v.clone().multiplyScalar(2))
    const terceira = () =>
      new THREE.MeshBasicMaterial({ color: cor.terceira, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    const visual = new THREE.Group()
    const nucleo = new THREE.Mesh(discoVoce, terceira())
    const anel = new THREE.Mesh(halo, terceira())
    visual.add(nucleo, anel)
    // O círculo da precisão é do tamanho real no chão: não acompanha a escala da tela.
    const circulo = new THREE.Mesh(precisaoAro, terceira())
    circulo.scale.setScalar(Math.max(5, precisao || 0) / R_TERRA)
    circulo.material.opacity = 0.5
    raiz.add(visual, circulo)
    globo.add(raiz)
    const el = div('atlas-rotulo atlas-voce')
    el.append(document.createTextNode('Você'))
    if (precisao) el.append(span('atlas-coord', `± ${Math.round(precisao).toLocaleString('pt-BR')} m`))
    rotulos.append(el)
    voce = { lat, lon, precisao, raiz, visual, anel, el, materiais: [nucleo.material, anel.material, circulo.material], contexto: CONTEXTO.voce }
  }
  function esconderVoce() {
    if (!voce) return
    globo.remove(voce.raiz)
    voce.materiais.forEach((m) => m.dispose())
    voce.el.remove()
    voce = null
  }

  /* --------------------------------------------- abrir e fechar */

  // fechado → abrindo → aberto → fechando → fechado
  let estado = 'fechado'
  let montagem = 0
  /** Some e surge dos pontos nas pontas da montagem, cruzando com o Enxame. */
  let surgir = 0
  let vooPendente = null
  let osm = false

  function abrir(centro) {
    if (estado === 'aberto' || estado === 'abrindo') return
    if (estado === 'fechado') {
      if (centro) Object.assign(vista, { lat: centro.lat, lon: centro.lon })
      vista.d = dDoNucleo()
      voo = null
    }
    estado = 'abrindo'
    apolo.nucleo.ceder()
    tela.style.pointerEvents = 'auto'
    ocioso = 0
    if (!rodando) iniciar()
  }
  function fechar() {
    if (estado === 'fechado' || estado === 'fechando') return
    estado = 'fechando'
    vooPendente = null
    tela.style.pointerEvents = 'none'
    limparMarcadores()
    esconderVoce()
    osm = false
    voar({ lat: vista.lat, lon: vista.lon, d: dDoNucleo() })
  }

  /* ------------------------------------------ busca (OpenStreetMap) */

  const CHAVE_DO_CACHE = 'atlas:busca:v2'
  let cache = {}
  try {
    cache = JSON.parse(localStorage.getItem(CHAVE_DO_CACHE) || '{}')
  } catch {
    cache = {}
  }
  const guardar = () => {
    try {
      const chaves = Object.keys(cache)
      if (chaves.length > 500) for (const k of chaves.slice(0, chaves.length - 500)) delete cache[k]
      localStorage.setItem(CHAVE_DO_CACHE, JSON.stringify(cache))
    } catch {
      /* sem armazenamento: só não guarda */
    }
  }

  async function pedirJson(url) {
    const parar = new AbortController()
    const prazo = setTimeout(() => parar.abort(), 8000)
    try {
      const r = await fetch(url, { signal: parar.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } finally {
      clearTimeout(prazo)
    }
  }

  /**
   * O tamanho do lugar, em graus de raio, pela caixa que a busca devolve. Nunca menos
   * que o contexto do tipo: o município de São Paulo cabe numa caixa de meio grau, e
   * mostrar só ele perde a referência de onde ele fica.
   */
  function contextoDaCaixa(caixa, tipo) {
    const minimo = CONTEXTO[tipo] ?? CONTEXTO.cidade
    if (!Array.isArray(caixa) || caixa.length !== 4 || caixa.some((x) => !Number.isFinite(x))) return minimo
    const [oeste, norte, leste, sul] = caixa
    const meia = deg(vetor(norte, oeste).angleTo(vetor(sul, leste))) / 2
    return clamp(Math.max(meia * 1.4, minimo), 0.01, 40)
  }
  /** Onde a busca achou, em palavras: a voz confere e corrige se for o lugar errado. */
  const ondeFica = (...partes) => [...new Set(partes.filter((p) => typeof p === 'string' && p.trim()))].join(', ')

  async function photon(nome, tipo) {
    const camadaDaBusca = CAMADA_DA_BUSCA[tipo]
    const base = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(nome)}`
    let f = camadaDaBusca ? (await pedirJson(`${base}&layer=${camadaDaBusca}`)).features?.[0] : null
    if (!f) f = (await pedirJson(base)).features?.[0]
    if (!f) return null
    const [lon, lat] = f.geometry.coordinates
    const p = f.properties ?? {}
    return { lat, lon, contexto: contextoDaCaixa(p.extent, tipo), onde: ondeFica(p.name, p.city, p.state, p.country) }
  }

  /**
   * A regra de uso do Nominatim é um pedido por segundo, no máximo. Uma fila só para
   * todos: cinco capitais levam cinco segundos na primeira vez e nada depois (cache).
   */
  let filaDoNominatim = Promise.resolve()
  let ultimoPedido = 0
  const vezDoNominatim = () => {
    const vez = filaDoNominatim.then(async () => {
      const espera = ultimoPedido + 1100 - Date.now()
      if (espera > 0) await new Promise((pronto) => setTimeout(pronto, espera))
      ultimoPedido = Date.now()
    })
    filaDoNominatim = vez
    return vez
  }

  async function nominatim(nome, tipo) {
    const feicao = { cidade: 'city', estado: 'state', pais: 'country' }[tipo]
    const url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&accept-language=pt-BR' +
      `&q=${encodeURIComponent(nome)}${feicao ? `&featureType=${feicao}` : ''}`
    await vezDoNominatim()
    const r = (await pedirJson(url))?.[0]
    if (!r) return null
    const b = (r.boundingbox ?? []).map(Number) // sul, norte, oeste, leste
    const e = r.address ?? {}
    return {
      lat: Number(r.lat),
      lon: Number(r.lon),
      contexto: contextoDaCaixa(b.length === 4 ? [b[2], b[1], b[3], b[0]] : null, tipo),
      onde: ondeFica(r.name, e.city ?? e.town ?? e.village, e.state, e.country),
    }
  }

  async function buscar(nome, tipo) {
    const chave = `${tipo ?? ''}|${nome.toLowerCase()}`
    if (cache[chave]) return cache[chave]
    let achado = null
    try {
      achado = await nominatim(nome, tipo)
    } catch {
      achado = null
    }
    if (!achado) {
      try {
        achado = await photon(nome, tipo)
      } catch {
        achado = null
      }
    }
    if (achado) {
      cache[chave] = achado
      guardar()
    }
    return achado
  }

  /** Resolve os lugares: coordenada dada vale como está; nome vai à busca, três por vez. */
  async function resolver(brutos, tipo) {
    const locais = brutos
      .slice(0, MAX_LOCAIS)
      .map((l) => ({ nome: String(l?.nome ?? '').trim(), lat: Number(l?.lat), lon: Number(l?.lon) }))
      .filter((l) => l.nome)
    const achados = new Array(locais.length).fill(null)
    const faltando = []
    let fila = 0
    const trabalhar = async () => {
      while (fila < locais.length) {
        const i = fila++
        const l = locais[i]
        if (Number.isFinite(l.lat) && Number.isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180) {
          achados[i] = { nome: l.nome, lat: l.lat, lon: l.lon, contexto: CONTEXTO.coordenada }
          continue
        }
        const r = await buscar(l.nome, tipo)
        if (r) {
          achados[i] = { nome: l.nome, ...r }
          osm = true
        } else faltando.push(l.nome)
      }
    }
    await Promise.all([trabalhar(), trabalhar(), trabalhar()])
    return { achados: achados.filter(Boolean), faltando }
  }

  /* ------------------------------------------------------- a voz */

  const listar = (ls) =>
    ls.length <= 6 ? ls.map((l) => l.nome).join(', ') : `${ls.slice(0, 5).map((l) => l.nome).join(', ')} e mais ${ls.length - 5}`

  apolo.ferramenta('mapa', async (args) => {
    const acao = String(args.acao ?? 'marcar')
    if (acao === 'fechar') {
      if (estado === 'fechado') return 'O mapa já estava fechado.'
      fechar()
      return 'Mapa fechado.'
    }
    if (acao === 'abrir') {
      if (estado === 'aberto') voar({ lat: vista.lat, lon: vista.lon, d: dGlobo() })
      abrir()
      return 'Mapa aberto.'
    }
    if (acao === 'minha_localizacao') {
      let posicao
      try {
        // A trava é do A.P.O.L.O.: só entrega se a fala dele pediu (como a câmera).
        posicao = await apolo.localizacao()
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
      if (estado === 'fechado' || estado === 'fechando') abrir()
      mostrarVoce(posicao)
      const quadro = enquadrar([...marcadores, voce])
      if (montagem < 0.55) vooPendente = quadro
      else voar(quadro)
      // A coordenada fica na tela: a resposta vai para o provedor da voz e não a leva.
      const precisao = posicao.precisao ? `, com precisão de uns ${Math.round(posicao.precisao)} metros` : ''
      return `A localização dele está marcada no mapa, na terceira cor${precisao}.`
    }
    if (acao === 'limpar') {
      const n = marcadores.length + (voce ? 1 : 0)
      limparMarcadores()
      esconderVoce()
      osm = false
      if (estado !== 'fechado') voar({ lat: vista.lat, lon: vista.lon, d: dGlobo() })
      return n ? 'Marcadores removidos.' : 'Não havia marcadores.'
    }
    if (acao === 'enquadrar') {
      if (estado === 'fechado') return 'O mapa está fechado.'
      voar(enquadrar(voce ? [...marcadores, voce] : marcadores))
      return marcadores.length ? 'Todos os marcadores na tela.' : 'Globo inteiro na tela.'
    }
    if (acao === 'aproximar' || acao === 'afastar') {
      if (estado === 'fechado') return 'O mapa está fechado.'
      const k = acao === 'aproximar' ? 0.45 : 2.2
      voar({ lat: vista.lat, lon: vista.lon, d: clamp(1 + (vista.d - 1) * k, DMIN, dGlobo()) })
      return acao === 'aproximar' ? 'Aproximado.' : 'Afastado.'
    }

    // marcar ou acrescentar
    const pedidos = Array.isArray(args.locais) ? args.locais : []
    if (!pedidos.length) return 'Nenhum lugar foi dado para marcar.'
    const tipo = typeof args.tipo === 'string' ? args.tipo : undefined
    // O globo começa a se montar já: a busca corre enquanto os pontos pousam.
    if (estado === 'fechado' || estado === 'fechando') abrir()
    const { achados, faltando } = await resolver(pedidos, tipo)
    const naoAchou = faltando.length ? ` Não encontrei: ${faltando.join(', ')}.` : ''
    if (!achados.length) return `Não encontrei nenhum dos lugares.${naoAchou}`
    if (acao !== 'acrescentar') limparMarcadores()
    if (typeof args.categoria === 'string' && args.categoria.trim()) categoria = args.categoria.trim().slice(0, 30)
    const quadro = enquadrar([...marcadores, ...achados, ...(voce ? [voce] : [])])
    acrescentar(achados)
    if (estado === 'fechado' || estado === 'fechando') abrir()
    if (montagem < 0.55) vooPendente = quadro
    else voar(quadro)
    const total = marcadores.length
    const achadosAgora = achados.map((l) => (l.onde ? `${l.nome} (${l.onde})` : l.nome)).join('; ')
    return (
      `${total === 1 ? 'Marcado' : `${total} marcados`} no mapa. Onde a busca achou: ${achadosAgora}.${naoAchou} ` +
      'Se algum for o lugar errado (outro país, outra cidade com o mesmo nome), marque de novo com o nome completo.'
    )
  })

  apolo.descreverTela(() => {
    if (estado === 'fechado' || estado === 'fechando') return ''
    const comVoce = voce ? ' A localização dele também está no mapa.' : ''
    return (
      (marcadores.length
        ? `O mapa está aberto com ${marcadores.length === 1 ? 'um marcador' : `${marcadores.length} marcadores`}: ${listar(marcadores)}.`
        : 'O mapa está aberto, sem marcadores.') + comVoce
    )
  })
  // Só fecha a pedido: "feche o mapa", Esc ou a espera pedida. Uma limpeza de tela
  // (que o agente de tarefas também faz sozinho, ao fim de um assunto) não é pedido.
  apolo.ao('espera', fechar)

  /* ------------------------------------------- mouse e toque */

  const toques = new Map()
  let arrasto = null
  let pinca = null
  let ultimoToque = 0
  let ocioso = 0
  const inercia = { x: 0, y: 0 }
  const grausPorPixel = () => deg((2 * (vista.d - 1) * Math.tan(rad(FOV / 2))) / Math.max(1, camada.clientHeight)) * 1.1
  const girar = (dLon, dLat) => {
    vista.lon = ((vista.lon + dLon + 540) % 360) - 180
    vista.lat = clamp(vista.lat + dLat, -82, 82)
  }

  const aoApertar = (e) => {
    if (estado !== 'aberto' && estado !== 'abrindo') return
    tela.setPointerCapture?.(e.pointerId)
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY })
    voo = null
    vooPendente = null
    ocioso = 0
    if (toques.size === 1) {
      const agora = performance.now()
      // Toque ou clique duplo: volta a mostrar todos os marcadores (ou o globo inteiro).
      if (agora - ultimoToque < 300) voar(enquadrar(marcadores))
      ultimoToque = agora
      arrasto = { x: e.clientX, y: e.clientY, t: agora }
      tela.classList.add('arrastando')
    } else if (toques.size === 2) {
      const [a, b] = [...toques.values()]
      pinca = { dist: Math.hypot(a.x - b.x, a.y - b.y), d: vista.d }
      arrasto = null
    }
  }
  const aoMover = (e) => {
    if (!toques.has(e.pointerId)) return
    toques.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ocioso = 0
    if (pinca && toques.size === 2) {
      const [a, b] = [...toques.values()]
      vista.d = clamp(1 + (pinca.d - 1) * (pinca.dist / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))), DMIN, DMAX)
    } else if (arrasto) {
      const gp = grausPorPixel()
      const dx = e.clientX - arrasto.x
      const dy = e.clientY - arrasto.y
      girar(-dx * gp, dy * gp)
      const dt = Math.max(8, performance.now() - arrasto.t)
      inercia.x = ((-dx * gp) / dt) * 16
      inercia.y = ((dy * gp) / dt) * 16
      arrasto = { x: e.clientX, y: e.clientY, t: performance.now() }
    }
  }
  const aoSoltar = (e) => {
    toques.delete(e.pointerId)
    if (toques.size < 2) pinca = null
    if (!toques.size) {
      arrasto = null
      tela.classList.remove('arrastando')
    } else if (toques.size === 1) {
      const [p] = toques.values()
      arrasto = { x: p.x, y: p.y, t: performance.now() }
      inercia.x = inercia.y = 0
    }
  }
  const aoRolar = (e) => {
    if (estado !== 'aberto' && estado !== 'abrindo') return
    e.preventDefault()
    voo = null
    vooPendente = null
    ocioso = 0
    vista.d = clamp(1 + (vista.d - 1) * Math.exp(e.deltaY * 0.0014), DMIN, DMAX)
  }
  tela.addEventListener('pointerdown', aoApertar)
  tela.addEventListener('pointermove', aoMover)
  tela.addEventListener('pointerup', aoSoltar)
  tela.addEventListener('pointercancel', aoSoltar)
  tela.addEventListener('wheel', aoRolar, { passive: false })

  /* ------------------------------------------------------- o laço */

  function redimensionar() {
    const w = Math.max(1, camada.clientWidth)
    const h = Math.max(1, camada.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const px = (h * renderer.getPixelRatio()) / (2 * Math.tan(rad(FOV / 2)))
    for (const m of materiais) m.uniforms.uSize.value = m.userData.tamanho * px
    pxPorUnidade = px
    for (const b of blocos.values()) if (b.material) b.material.uniforms.uSize.value = b.material.uniforms.uTamanho.value * px
  }
  const observador = new ResizeObserver(redimensionar)
  observador.observe(camada)
  redimensionar()

  // Contado à mão: o THREE.Clock está obsoleto, e o laço só precisa do intervalo.
  let ultimoQuadro = 0
  let relogio = 0
  let ultimaEscolha = 0
  let cidadeAlfa = 0
  let rodando = false
  const qx = new THREE.Quaternion()
  const qy = new THREE.Quaternion()
  const X = new THREE.Vector3(1, 0, 0)
  const Y = new THREE.Vector3(0, 1, 0)
  const tmp = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const paraCamera = new THREE.Vector3()

  function iniciar() {
    rodando = true
    ultimoQuadro = performance.now()
    renderer.setAnimationLoop(quadro)
  }
  function parar() {
    rodando = false
    renderer.setAnimationLoop(null)
    renderer.clear()
  }

  /* ------------------------------------------- os nomes dos lugares
   * Em letra fina, na cor da interface, só com a cidade na tela. Cada zoom mostra a
   * escala que faz sentido: cidades de longe, bairros de perto. Sem se encostar.
   */
  const nomes = new Map()
  const PRIORIDADE = { city: 0, town: 1, suburb: 2, quarter: 3, neighbourhood: 4, village: 5, hamlet: 6 }
  const classesDoZoom = (z) =>
    z <= 11 ? ['city', 'town'] : z === 12 ? ['city', 'town', 'suburb'] : z === 13 ? ['town', 'suburb', 'quarter', 'village'] : ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet']
  function desenharNomes(temCidade, w, h) {
    const usados = new Set()
    if (temCidade > 0.3) {
      const aceitas = new Set(classesDoZoom(zAtual))
      const candidatos = []
      for (const b of blocos.values()) {
        if (!b.pontos || b.saindo || b.z !== zAtual || b.chegada < 0.5) continue
        for (const l of b.lugares) if (aceitas.has(l.classe)) candidatos.push(l)
      }
      candidatos.sort((p, q) => PRIORIDADE[p.classe] - PRIORIDADE[q.classe] || p.rank - q.rank)
      const caixas = []
      for (const l of candidatos) {
        if (usados.size >= 18) break
        tmp.copy(l.v).applyMatrix4(globo.matrixWorld).project(camera)
        if (tmp.z > 1) continue
        const x = (tmp.x * 0.5 + 0.5) * w
        const y = (-tmp.y * 0.5 + 0.5) * h
        if (x < 40 || x > w - 40 || y < 40 || y > h - 40) continue
        const largura = l.nome.length * 7.5 + 14
        if (caixas.some((c) => Math.abs(c.x - x) < (c.largura + largura) / 2 && Math.abs(c.y - y) < 20)) continue
        caixas.push({ x, y, largura })
        const chave = `${l.nome}|${l.lat.toFixed(4)}`
        let el = nomes.get(chave)
        if (!el) {
          el = div('atlas-lugar')
          // "Pinheiros (Bairro)" vira "Pinheiros": o parêntese é para desambiguar no OpenStreetMap.
          el.textContent = l.nome.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
          rotulos.append(el)
          nomes.set(chave, el)
        }
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`
        el.style.opacity = String(Math.min(1, temCidade) * 0.6)
        usados.add(chave)
      }
    }
    for (const [chave, el] of nomes) {
      if (usados.has(chave)) continue
      el.style.opacity = '0'
      if (nomes.size > 300) {
        el.remove()
        nomes.delete(chave)
      }
    }
  }

  /** O raio da tela, do centro à borda de cima, medido no chão. */
  function raioKm() {
    const phi = rad(FOV / 2)
    const d = vista.d
    const b = 2 * d * Math.cos(phi)
    const disc = b * b - 4 * (d * d - 1)
    let ang
    if (disc < 0) ang = Math.acos(1 / d)
    else {
      const t = (b - Math.sqrt(disc)) / 2
      ang = Math.atan2(t * Math.sin(phi), d - t * Math.cos(phi))
    }
    return ang * 6371
  }

  function quadro() {
    const agora = performance.now()
    const dt = Math.min(0.05, (agora - ultimoQuadro) / 1000)
    ultimoQuadro = agora
    relogio += dt
    ocioso += dt

    // A montagem: 2,4 s para pousar, 1,6 s para voltar a ser o Enxame.
    if (estado === 'abrindo') {
      surgir = Math.min(1, surgir + dt / 0.45)
      montagem = Math.min(1, montagem + dt / 2.4)
      // Sem pedido, cresce (ou encolhe) do tamanho do Enxame até o do globo inteiro.
      if (!voo && !vooPendente && montagem > 0.02 && Math.abs(vista.d - dGlobo()) > dGlobo() * 0.01) {
        voar({ lat: vista.lat, lon: vista.lon, d: dGlobo() })
      }
      if (montagem >= 1) estado = 'aberto'
    } else if (estado === 'fechando') {
      montagem = Math.max(0, montagem - dt / 1.6)
      // O Enxame volta enquanto os últimos pontos se juntam: os dois se cruzam.
      if (montagem < 0.2) {
        apolo.nucleo.devolver()
        surgir = Math.max(0, surgir - dt / 0.35)
      }
      if (montagem <= 0 && surgir <= 0) {
        estado = 'fechado'
        parar()
        return
      }
    }
    // Começa a voar para o pedido antes de a montagem terminar: um movimento só.
    if (vooPendente && montagem > 0.55) {
      voar(vooPendente)
      vooPendente = null
    }
    passoDoVoo(dt)
    if (!arrasto && !voo && (inercia.x || inercia.y)) {
      girar(inercia.x, inercia.y)
      inercia.x *= 0.92
      inercia.y *= 0.92
      if (Math.abs(inercia.x) + Math.abs(inercia.y) < 1e-3) inercia.x = inercia.y = 0
    }
    // Sem pedido nem mão por perto, o globo gira devagar.
    if (estado === 'aberto' && !voo && !arrasto && !marcadores.length && !voce && ocioso > 4 && vista.d > 2) girar(dt * 3, 0)

    qy.setFromAxisAngle(Y, -rad(vista.lon))
    qx.setFromAxisAngle(X, rad(vista.lat))
    globo.quaternion.multiplyQuaternions(qx, qy)
    camera.position.set(0, 0, vista.d)
    camera.lookAt(0, 0, 0)
    // Perto do chão, o plano de corte também chega perto: senão as ruas somem.
    camera.near = Math.max(1e-7, (vista.d - 1) * 0.05)
    camera.far = vista.d + 2
    camera.updateProjectionMatrix()
    globo.updateMatrixWorld()

    cor.interface.lerp(alvoDaCor.interface, Math.min(1, dt * 3))
    cor.contraste.lerp(alvoDaCor.contraste, Math.min(1, dt * 3))
    cor.terceira.lerp(alvoDaCor.terceira, Math.min(1, dt * 3))

    // A cidade: blocos da tela, chegando do alto e se assentando; somem ao subir.
    const km = raioKm()
    const querCidade = estado === 'aberto' && km < CIDADE_SOME_KM
    if (querCidade) {
      // Reancora só quando a vista se afasta muito da âncora (relativo à escala), para não piscar.
      if (!ancoraVetor || vetor(vista.lat, vista.lon).angleTo(ancoraVetor) * 6371 > Math.max(150, km * 3)) ancorar(vista.lat, vista.lon)
      if (relogio - ultimaEscolha > 0.15) {
        ultimaEscolha = relogio
        escolherBlocos(km)
      }
      andarFila()
    } else if (blocos.size) {
      // Subiu acima da cidade: o que ainda ia baixar sai da fila; o que está na tela some aos poucos.
      fila.length = 0
      for (const b of [...blocos.values()]) {
        if (b.pontos) b.saindo = true
        else blocos.delete(b.chave)
      }
    }
    const alvoCidade = querCidade ? 1 - THREE.MathUtils.smoothstep(km, CIDADE_KM, CIDADE_SOME_KM) : 0
    cidadeAlfa += (alvoCidade - cidadeAlfa) * Math.min(1, dt * 4)
    let cidadeNaTela = 0
    for (const b of [...blocos.values()]) {
      if (!b.pontos) continue
      if (b.saindo) {
        b.alfa -= dt / 0.45
        if (b.alfa <= 0) {
          removerBloco(b)
          continue
        }
      } else {
        b.alfa = Math.min(1, b.alfa + dt / 0.3)
        b.chegada = Math.min(1, b.chegada + dt / 1.3)
        cidadeNaTela++
      }
      const u = b.material.uniforms
      u.uChegada.value = b.chegada
      u.uAlfa.value = b.alfa * cidadeAlfa
      u.uTime.value = relogio
    }
    if (!querCidade && !blocos.size && ancoraVetor && km > CIDADE_SOME_KM * 3) ancoraVetor = null
    const temCidade = cidadeNaTela > 0 ? cidadeAlfa : 0

    // De longe, a camada leve; de perto, a densa. Perto, o outro lado do mundo some.
    const longe = THREE.MathUtils.smoothstep(vista.d, 1.42, 1.85)
    const fundo = THREE.MathUtils.smoothstep(vista.d, 1.6, 2.6)
    // Montando, os pontos chegam girando nas faixas do Enxame, cada vez mais devagar.
    const giro = dt * 0.9 * (1 - montagem) ** 2
    for (const m of materiais) {
      const u = m.uniforms
      u.uTime.value = relogio
      u.uMontagem.value = montagem
      u.uGiro.value += giro
      u.uFundo.value = fundo
      u.uColor.value.copy(cor.interface)
    }
    matTerra.uniforms.uAlfa.value = longe * surgir
    // Com a cidade na tela, os pontos grossos do globo dão lugar a ela.
    matPerto.uniforms.uAlfa.value = (1 - longe) * surgir * (1 - 0.85 * temCidade)
    matMar.uniforms.uAlfa.value = 0.16 * (0.4 + 0.6 * fundo) * surgir * (1 - temCidade)
    pontosTerra.visible = longe > 0.01
    pontosPerto.visible = longe < 0.99 && montagem > 0.9
    matAr.uniforms.uColor.value.copy(cor.interface)
    matAr.uniforms.uAlfa.value = THREE.MathUtils.smoothstep(montagem, 0.6, 1) * surgir * (1 - temCidade)
    ar.visible = matAr.uniforms.uAlfa.value > 0.01

    // Os faróis: tamanho constante na tela, nascem em sequência, rótulo só no lado visível.
    const escala = clamp((vista.d - 1) / 2.2, 1e-7, 1.3)
    const w = camada.clientWidth
    const h = camada.clientHeight
    const naTela = (raiz) => {
      raiz.getWorldPosition(tmp)
      normal.copy(tmp).normalize()
      const frente = normal.dot(paraCamera.copy(camera.position).sub(tmp).normalize())
      tmp.project(camera)
      return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, frente }
    }
    const lista = []
    for (const m of marcadores) {
      const idade = clamp((relogio - m.nasce) * 2.2, 0, 1) * THREE.MathUtils.smoothstep(montagem, 0.7, 1)
      m.visual.scale.setScalar(escala * (idade < 1 ? suave(idade) * 1.15 : 1))
      m.visual.userData.anima(relogio, m.seed)
      for (const mt of m.visual.userData.materiais) mt.color.copy(cor.contraste)
      const p = naTela(m.raiz)
      // Atrás do globo o feixe apareceria saindo da borda, solto: só o lado visível.
      lista.push({ m, ...p, idade, vis: p.frente > 0.05 && idade > 0.6 })
    }
    // Juntos demais na tela, viram um grupo com a contagem, até o zoom os separar.
    const grupos = []
    for (const r of lista) {
      if (!(r.frente > 0.02 && r.idade > 0)) continue
      const g = grupos.find((q) => Math.hypot(q.x - r.x, q.y - r.y) < JUNTOS_PX)
      if (g) {
        g.membros.push(r)
        // O grupo fica no meio dos seus.
        g.x += (r.x - g.x) / g.membros.length
        g.y += (r.y - g.y) / g.membros.length
      } else grupos.push({ x: r.x, y: r.y, membros: [r] })
    }
    for (const r of lista) {
      r.m.visual.visible = false
      r.m.el.style.opacity = '0'
    }
    // Um rótulo por grupo (ou por marcador solto), todos na mesma arrumação.
    const etiquetas = []
    let k = 0
    for (const g of grupos) {
      g.membros[0].m.visual.visible = true
      if (g.membros.length === 1) {
        const r = g.membros[0]
        etiquetas.push({ el: r.m.el, x: r.x, y: r.y, vis: r.vis })
        continue
      }
      const el = rotuloDeGrupo(k++)
      el.innerHTML = ''
      el.append(span('atlas-num', String(g.membros.length)), document.createTextNode(categoria || 'lugares'))
      el.append(span('atlas-coord', 'aproxime para separar'))
      etiquetas.push({ el, x: g.x, y: g.y, vis: true })
    }
    for (; k < rotulosDeGrupo.length; k++) rotulosDeGrupo[k].style.opacity = '0'
    // Rótulos que se encostariam descem, em vez de se sobrepor.
    etiquetas.sort((a, b) => a.y - b.y)
    const ocupados = []
    for (const e of etiquetas) {
      let y = e.y - 9
      for (const o of ocupados) if (Math.abs(o.x - e.x) < 170 && Math.abs(o.y - y) < 28) y = o.y + 28
      ocupados.push({ x: e.x, y })
      e.el.style.transform = `translate(${Math.round(e.x + 10)}px, ${Math.round(y)}px)`
      e.el.style.opacity = e.vis ? '1' : '0'
    }

    // A localização dele: o ponto na terceira cor, um halo que respira e o rótulo.
    if (voce) {
      voce.visual.scale.setScalar(escala)
      const kk = (relogio * 0.45) % 1
      voce.anel.scale.setScalar(0.8 + kk * 1.4)
      voce.materiais[1].opacity = (1 - kk) * 0.9
      for (const mt of voce.materiais) mt.color.copy(cor.terceira)
      const p = naTela(voce.raiz)
      const vis = p.frente > 0.05 && montagem > 0.7
      voce.raiz.visible = p.frente > 0.02
      voce.el.style.transform = `translate(${Math.round(p.x + 12)}px, ${Math.round(p.y - 9)}px)`
      voce.el.style.opacity = vis ? '1' : '0'
    }

    desenharNomes(temCidade, w, h)

    const visivel = estado === 'aberto' || (estado === 'abrindo' && montagem > 0.5)
    leitura.style.opacity = visivel ? '0.7' : '0'
    if (visivel) {
      const casas = km < 50 ? 4 : 2
      const raio = km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${(Math.round(km / 10) * 10).toLocaleString('pt-BR')} km`
      const fonte = temCidade > 0.05 ? ' · © OpenFreeMap © OpenMapTiles © OpenStreetMap' : osm ? ' · © OpenStreetMap' : ''
      // Sem rede (ou o servidor fora), a cidade não vem: diz, em vez de deixar o chão vazio.
      const semRuas = querCidade && falhasDeBloco >= 6 && !cidadeNaTela ? ' · ruas indisponíveis agora' : ''
      leitura.textContent = `${fmt(vista.lat, 'N', 'S', casas)} ${fmt(vista.lon, 'L', 'O', casas)} · raio ≈ ${raio}${fonte}${semRuas}`
    }
    renderer.render(scene, camera)
  }

  // Sobe os pontos para a placa de vídeo agora, invisível, para a primeira abertura não engasgar.
  for (const m of materiais) m.uniforms.uAlfa.value = 0
  renderer.compile(scene, camera)
  renderer.render(scene, camera)
  renderer.clear()

  return () => {
    parar()
    observador.disconnect()
    limparMarcadores()
    esconderVoce()
    limparBlocos()
    trabalhador.terminate()
    URL.revokeObjectURL(trabalhadorUrl)
    for (const el of nomes.values()) el.remove()
    discoVoce.dispose()
    halo.dispose()
    precisaoAro.dispose()
    apolo.nucleo.devolver()
    for (const p of [pontosTerra, pontosMar, pontosPerto]) p.geometry.dispose()
    for (const m of [...materiais, matAr]) m.dispose()
    ar.geometry.dispose()
    disco.dispose()
    aro.dispose()
    feixe.dispose()
    renderer.dispose()
  }
}

function div(classe) {
  const el = document.createElement('div')
  el.className = classe
  return el
}
function span(classe, texto) {
  const el = document.createElement('span')
  el.className = classe
  el.textContent = texto
  return el
}

/* ---------------------------------------------------------------- shaders */

const VERTEX = /* glsl */ `
  attribute vec2 aInicio;
  attribute float aSeed;
  attribute float aCosta;
  uniform float uTime, uMontagem, uGiro, uSize, uAlfa, uFundo;
  varying float vAlpha, vCosta;

  vec3 esfera(float lat, float lon) { return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)); }

  void main() {
    // Cada ponto pousa no seu tempo: os primeiros a chegar puxam os outros.
    float k = clamp(uMontagem * 1.5 - aSeed * 0.5, 0.0, 1.0);
    float e = k * k * (3.0 - 2.0 * k);

    // De onde ele sai: uma latitude qualquer, a longitude do destino com um desvio,
    // e o giro das faixas do Enxame (sentidos alternados), que morre ao pousar.
    float lat1 = asin(clamp(position.y, -1.0, 1.0));
    float lon1 = atan(position.x, position.z);
    float faixa = floor((sin(aInicio.x) + 1.0) * 7.0);
    float sentido = mod(faixa, 2.0) * 2.0 - 1.0;
    float lat = mix(aInicio.x, lat1, e);
    float lon = lon1 + (aInicio.y + sentido * uGiro * 2.4) * (1.0 - e);
    // Um arco leve para fora no meio do caminho: eles voam, não arrastam.
    vec3 p = esfera(lat, lon) * (1.0 + 0.05 * sin(3.14159 * e));
    // Flutuar: um respiro mínimo ao longo da normal, para nunca parecerem impressos.
    p += position * sin(uTime * 0.8 + aSeed * 40.0) * 0.0032 * e;

    vec4 mundo = modelMatrix * vec4(p, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normalize(p));
    float frente = smoothstep(-0.08, 0.28, dot(n, normalize(cameraPosition - mundo.xyz)));
    // No caminho, ainda são o Enxame: mais tênues e mais finos.
    vAlpha = mix(0.22, mix(0.06 * uFundo, 1.0, frente) * mix(0.78, 1.0, aCosta), e) * uAlfa;
    vCosta = aCosta * e;
    vec4 mv = viewMatrix * mundo;
    gl_PointSize = clamp(uSize * mix(0.7, 1.0 + aCosta * 0.3, e) / -mv.z, 1.0, 13.0);
    gl_Position = projectionMatrix * mv;
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha, vCosta;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float f = 1.0 - smoothstep(0.1, 0.5, r);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), vCosta * 0.22), vAlpha * f);
  }
`

/**
 * Os pontos da cidade: cada um sai de um enxame solto no ar, na escala da tela, desce e
 * se assenta na rua, no seu tempo. O brilho diz a importância: via expressa e rio mais
 * fortes, rua de bairro e parque mais fracos. Nenhuma cor nova.
 */
const VERTEX_CIDADE = /* glsl */ `
  attribute float aClasse;
  attribute float aSeed;
  uniform float uSize, uChegada, uEscala, uAlfa, uTime;
  varying float vAlpha, vCosta;
  float acaso(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float k = clamp(uChegada * 1.6 - aSeed * 0.6, 0.0, 1.0);
    float e = k * k * (3.0 - 2.0 * k);
    vec3 inicio = position + vec3(
      (acaso(aSeed * 91.7) - 0.5) * uEscala * 0.5,
      (acaso(aSeed * 37.3) - 0.5) * uEscala * 0.5,
      (0.35 + acaso(aSeed * 13.1) * 0.65) * uEscala);
    vec3 p = mix(inicio, position, e);
    float c = aClasse;
    // 0 expressa, 1 principal, 2 secundária, 3 terciária, 4 rua, 5 serviço, 6 água, 7 córrego, 8 parque, 9 trilho
    float brilho = c < 0.5 ? 1.0 : c < 1.5 ? 0.9 : c < 2.5 ? 0.78 : c < 3.5 ? 0.64 : c < 4.5 ? 0.5
      : c < 5.5 ? 0.32 : c < 6.5 ? 0.95 : c < 7.5 ? 0.5 : c < 8.5 ? 0.36 : 0.4;
    vAlpha = brilho * e * uAlfa * (0.88 + 0.12 * sin(uTime * 1.3 + aSeed * 50.0));
    vCosta = (c < 0.5 || (c > 5.5 && c < 6.5)) ? 0.35 : 0.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tam = c < 1.5 ? 1.25 : (c > 5.5 && c < 6.5) ? 1.15 : c > 7.5 ? 0.85 : 1.0;
    gl_PointSize = clamp(uSize * tam / -mv.z, 1.2, 5.5);
    gl_Position = projectionMatrix * mv;
  }
`

/** O código do Web Worker: o decodificador abaixo, com a porta de mensagens. */
function codigoDoTrabalhador() {
  return `${processarBloco.toString()}
self.onmessage = (e) => {
  const { id, buf, p } = e.data
  try {
    const r = processarBloco(buf, p)
    self.postMessage({ id, r }, [r.pos.buffer, r.cls.buffer, r.seed.buffer])
  } catch (err) {
    self.postMessage({ id, erro: String((err && err.message) || err) })
  }
}`
}

const CSS = `
  .atlas { --atlas-cor: #00e5ff; --atlas-contraste: #ff7666; --atlas-terceira: #ffd23c; }
  .atlas-lugar {
    position: absolute; left: 0; top: 0; white-space: nowrap; opacity: 0; transition: opacity .35s; pointer-events: none;
    color: var(--atlas-cor); font: 300 10px/1 var(--font-mono, ui-monospace, monospace); letter-spacing: .22em; text-transform: uppercase;
  }
  .atlas-grupo { font-size: 12px; }
  .atlas-voce { color: var(--atlas-terceira); text-shadow: 0 0 8px color-mix(in srgb, var(--atlas-terceira) 60%, transparent); }
  .atlas-voce::before { background: var(--atlas-terceira); }
  .atlas-tela { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; touch-action: none; cursor: grab; }
  .atlas-tela.arrastando { cursor: grabbing; }
  .atlas-rotulos { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .atlas-rotulo {
    position: absolute; left: 0; top: 0; white-space: nowrap; opacity: 0; transition: opacity .25s; will-change: transform, opacity;
    padding: 2px 7px 2px 14px; color: var(--atlas-cor);
    font: 400 11px/14px var(--font-mono, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase;
    text-shadow: 0 0 8px color-mix(in srgb, var(--atlas-cor) 60%, transparent);
  }
  .atlas-rotulo::before { content: ''; position: absolute; left: 0; top: 8px; width: 10px; height: 1px; background: var(--atlas-contraste); }
  .atlas-num { color: var(--atlas-contraste); margin-right: 6px; }
  .atlas-coord { display: block; opacity: .55; font-size: 9px; letter-spacing: .08em; }
  .atlas-leitura {
    position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
    opacity: 0; transition: opacity .4s; pointer-events: none; white-space: nowrap; color: var(--atlas-cor);
    font: 400 10px/1.4 var(--font-mono, ui-monospace, monospace); letter-spacing: .14em; text-transform: uppercase;
  }
`

/**
 * Transforma um bloco vetorial (Mapbox Vector Tile, esquema OpenMapTiles) em pontos.
 *
 * Função pura e sem nada de fora: roda num Web Worker (o texto dela vira o código do
 * trabalhador) e nos testes. Vias, rios, água e parques viram pontos espaçados ao
 * longo das linhas, já no plano da âncora (em raios da Terra, relativos a ela); os
 * lugares com nome (bairros, cidades) voltam à parte, para os rótulos.
 *
 * @param {ArrayBuffer} buf o bloco
 * @param {{ z: number, x: number, y: number, ancora: number[], base: number[] }} p
 *   `ancora`: o vetor unitário do centro; `base`: leste, norte e cima (9 números).
 */
export function processarBloco(buf, p) {
  const b = new Uint8Array(buf)
  const R_TERRA = 6371008.8

  // --- protobuf, só o necessário
  let i = 0
  const varint = () => {
    let v = 0
    let s = 0
    let byte
    do {
      byte = b[i++]
      v += (byte & 0x7f) * 2 ** s
      s += 7
    } while (byte & 0x80)
    return v
  }
  const pular = (tipo) => {
    if (tipo === 0) varint()
    else if (tipo === 1) i += 8
    else if (tipo === 2) i += varint()
    else if (tipo === 5) i += 4
  }
  const texto = (fim) => new TextDecoder().decode(b.subarray(i, fim))
  const zigzag = (n) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2)

  // --- o que interessa do esquema
  const CAMADAS = new Set(['transportation', 'waterway', 'water', 'park', 'place'])
  // 0 expressa, 1 principal, 2 secundária, 3 terciária, 4 rua, 5 serviço, 6 água, 7 córrego, 8 parque, 9 trilho
  const VIAS = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, minor: 4, service: 5, track: 5, rail: 9 }
  const ESPACO = [1, 1.1, 1.3, 1.5, 1.25, 1.7, 1.1, 1.6, 1.7, 1.6]
  const LUGARES = new Set(['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood', 'hamlet'])

  const n = 2 ** p.z
  const [Ax, Ay, Az] = p.ancora
  const [Ex, Ey, Ez, Nx, Ny, Nz, Ux, Uy, Uz] = p.base
  const latDoBloco = Math.atan(Math.sinh(Math.PI * (1 - (2 * (p.y + 0.5)) / n)))
  const metrosDoBloco = (2 * Math.PI * R_TERRA * Math.cos(latDoBloco)) / n

  const pos = []
  const cls = []
  const lugares = []

  const paraLatLon = (tx, ty, extent) => {
    const X = (p.x + tx / extent) / n
    const Y = (p.y + ty / extent) / n
    return [Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))), X * 2 * Math.PI - Math.PI]
  }
  const ponto = (tx, ty, extent, classe) => {
    const [lat, lon] = paraLatLon(tx, ty, extent)
    const c = Math.cos(lat)
    const vx = c * Math.sin(lon) - Ax
    const vy = Math.sin(lat) - Ay
    const vz = c * Math.cos(lon) - Az
    pos.push(vx * Ex + vy * Ey + vz * Ez, vx * Nx + vy * Ny + vz * Nz, vx * Ux + vy * Uy + vz * Uz)
    cls.push(classe)
  }

  /** Pontos ao longo das linhas, só dentro do bloco (a borda extra é do vizinho). */
  const amostrar = (linhas, extent, classe) => {
    const passo = ((metrosDoBloco / 170) * ESPACO[classe] * extent) / metrosDoBloco
    const dentro = (x, y) => x >= 0 && x < extent && y >= 0 && y < extent
    for (const l of linhas) {
      let resto = 0
      for (let k = 2; k + 1 < l.length; k += 2) {
        const x0 = l[k - 2]
        const y0 = l[k - 1]
        const x1 = l[k]
        const y1 = l[k + 1]
        const L = Math.hypot(x1 - x0, y1 - y0)
        if (!L) continue
        // O recorte de um polígono na borda vira uma aresta reta fora do bloco: não é chão.
        if (!dentro(x0, y0) && !dentro(x1, y1)) {
          resto = 0
          continue
        }
        let t = resto
        while (t <= L) {
          const x = x0 + ((x1 - x0) * t) / L
          const y = y0 + ((y1 - y0) * t) / L
          if (dentro(x, y)) ponto(x, y, extent, classe)
          t += passo
        }
        resto = t - L
      }
    }
  }

  /** Comandos da geometria em linhas: [x0, y0, x1, y1, ...] por linha ou anel. */
  const geometria = (fim) => {
    const linhas = []
    let atual = null
    let x = 0
    let y = 0
    while (i < fim) {
      const cmd = varint()
      const id = cmd & 7
      const vezes = cmd >> 3
      if (id === 7) {
        if (atual && atual.length >= 2) atual.push(atual[0], atual[1])
        continue
      }
      for (let k = 0; k < vezes; k++) {
        x += zigzag(varint())
        y += zigzag(varint())
        if (id === 1) {
          atual = [x, y]
          linhas.push(atual)
        } else atual.push(x, y)
      }
    }
    return linhas
  }

  const camada = (fim) => {
    let nome = ''
    let extent = 4096
    const chaves = []
    const valores = []
    const feicoes = []
    while (i < fim) {
      const tag = varint()
      const campo = tag >> 3
      if (campo === 1) {
        const l = varint()
        nome = texto(i + l)
        i += l
        if (!CAMADAS.has(nome)) {
          i = fim
          return
        }
      } else if (campo === 2) {
        const l = varint()
        feicoes.push([i, i + l])
        i += l
      } else if (campo === 3) {
        const l = varint()
        chaves.push(texto(i + l))
        i += l
      } else if (campo === 4) {
        const l = varint()
        const fv = i + l
        let v = null
        while (i < fv) {
          const t = varint()
          const f = t >> 3
          if (f === 1) {
            const s = varint()
            v = texto(i + s)
            i += s
          } else if (f === 2) {
            v = new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true)
            i += 4
          } else if (f === 3) {
            v = new DataView(b.buffer, b.byteOffset + i, 8).getFloat64(0, true)
            i += 8
          } else if (f === 4 || f === 5) v = varint()
          else if (f === 6) v = zigzag(varint())
          else if (f === 7) v = Boolean(varint())
          else pular(t & 7)
        }
        valores.push(v)
      } else if (campo === 5) extent = varint()
      else pular(tag & 7)
    }

    for (const [ini, fimF] of feicoes) {
      i = ini
      const props = {}
      let tipo = 0
      let geo = null
      while (i < fimF) {
        const tag = varint()
        const campo = tag >> 3
        if (campo === 2) {
          const fimT = i + varint()
          while (i < fimT) {
            const k = varint()
            const v = varint()
            props[chaves[k]] = valores[v]
          }
        } else if (campo === 3) tipo = varint()
        else if (campo === 4) {
          const l = varint()
          geo = [i, i + l]
          i += l
        } else pular(tag & 7)
      }
      if (!geo) continue
      i = geo[0]
      const linhas = geometria(geo[1])
      if (nome === 'place') {
        if (tipo !== 1 || !LUGARES.has(props.class)) continue
        const nomeDoLugar = props['name:pt'] || props.name || props.name_int
        if (!nomeDoLugar || !linhas[0]) continue
        const [lat, lon] = paraLatLon(linhas[0][0], linhas[0][1], extent)
        if (linhas[0][0] < 0 || linhas[0][0] >= extent || linhas[0][1] < 0 || linhas[0][1] >= extent) continue
        lugares.push({ nome: String(nomeDoLugar), classe: props.class, rank: Number(props.rank ?? 10), lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI })
        continue
      }
      let classe = null
      if (nome === 'transportation') {
        if (props.brunnel === 'tunnel') continue
        classe = VIAS[props.class] ?? null
        // Ruas de bairro só de perto (zoom 13 para baixo): de longe viram poeira.
        if (p.z < 13 && (classe === 4 || classe === 5)) continue
      } else if (nome === 'waterway') classe = props.class === 'river' || props.class === 'canal' ? 6 : 7
      else if (nome === 'water') classe = 6
      else if (nome === 'park') classe = 8
      if (classe === null || tipo < 2) continue
      amostrar(linhas, extent, classe)
    }
  }

  while (i < b.length) {
    const tag = varint()
    if (tag >> 3 === 3) {
      const l = varint()
      const fim = i + l
      camada(fim)
      i = fim
    } else pular(tag & 7)
  }

  const m = cls.length
  const seed = new Float32Array(m)
  for (let k = 0; k < m; k++) seed[k] = Math.random()
  return { pos: new Float32Array(pos), cls: new Float32Array(cls), seed, lugares }
}

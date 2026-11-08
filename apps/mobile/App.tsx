import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { NetworkStateType, addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { contrastante } from '../../src/lib/cor'
import { ROTULO_DE_ATIVIDADE, atividadeDaFerramenta, type Atividade } from '../../src/lib/estados'
import { Canal, type EstadoDoCanal } from './src/canal'
import { Cena, type Motor } from './src/Cena'
import { apagarPareamento, lerPareamento, salvarPareamento } from './src/cofre'
import type { Pareamento } from './src/pareamento'
import { Popups, type ControleDePopups, type MensagemDaPagina } from './src/Popups'
import { TelaDePareamento } from './src/TelaDePareamento'
import { Telemetria, type Rede } from './src/telemetria'
import { COR_DA_INTERFACE, COR_DE_FUNDO, COR_DO_TEXTO, FONTE_MONO, type Fase } from './src/tema'

/** Mudar a cor da interface muda esta junto, como a aba SISTEMAS na web. */
const COR_DE_ALERTA = contrastante(COR_DA_INTERFACE)

const FASE_DA_VOZ: Record<NonNullable<MensagemDaPagina['fase']>, Fase> = {
  desligada: 'ocioso',
  espera: 'espera',
  ouvindo: 'ouvindo',
  pensando: 'processando',
  ferramenta: 'processando',
  falando: 'falando',
}

/** O mesmo rótulo do HUD: a palavra confirma o que o círculo está mostrando. */
const ROTULO_DA_VOZ: Record<NonNullable<MensagemDaPagina['fase']>, string> = {
  desligada: '',
  espera: 'EM ESPERA · DIGA APOLO OU TOQUE',
  ouvindo: 'OUVINDO',
  pensando: 'PENSANDO',
  ferramenta: 'EXECUTANDO',
  falando: 'FALANDO',
}

/** Quanto tempo o que ele ouviu fica na tela depois da última palavra. */
const OUVIDO_NA_TELA_MS = 3_000
const SUMICO_DO_OUVIDO_MS = 500
/** Uma frase longa mostra o fim, que é o que está chegando agora. */
const OUVIDO_MAXIMO = 110

const redeDe = (estado: NetworkState): Rede => {
  if (!estado.isConnected) return 'sem_rede'
  if (estado.type === NetworkStateType.WIFI) return 'wifi'
  if (estado.type === NetworkStateType.CELLULAR) return 'celular'
  return 'outra'
}

function Tela() {
  const [carregado, setCarregado] = useState(false)
  const [par, setPar] = useState<Pareamento | null>(null)
  const [estado, setEstado] = useState<EstadoDoCanal>('desligado')
  const [base, setBase] = useState<string | null>(null)
  const [pagina, setPagina] = useState(false)
  const [aviso, setAviso] = useState('')
  const [rotulo, setRotulo] = useState('')
  const [ouvido, setOuvido] = useState('')
  const opacidadeDoOuvido = useRef(new Animated.Value(0)).current
  const motor = useRef<Motor>({ fase: 'offline', nivel: 0 })
  const conectadoAgora = useRef(false)
  const faseDaVoz = useRef<NonNullable<MensagemDaPagina['fase']>>('desligada')
  /** Com tarefa em andamento, a cor é dela: a fala não pode parecer que acabou. */
  const atividade = useRef<Atividade | null>(null)
  const popups = useRef<ControleDePopups>(null)
  /** A tarefa que a voz pediu e que o agente está fazendo. Uma por vez, como no canal. */
  const tarefa = useRef<string | null>(null)

  const mostrarFase = () => {
    const faseAtual = atividade.current ?? FASE_DA_VOZ[faseDaVoz.current]
    if (conectadoAgora.current) motor.current.fase = faseAtual
    setRotulo(atividade.current ? ROTULO_DE_ATIVIDADE[atividade.current] : ROTULO_DA_VOZ[faseDaVoz.current])
  }
  const mostrar = useRef(mostrarFase)
  mostrar.current = mostrarFase

  const concluirTarefa = (texto: string) => {
    if (tarefa.current) popups.current?.fimDaTarefa(tarefa.current, texto)
    tarefa.current = null
    atividade.current = null
    mostrarFase()
  }
  const concluir = useRef(concluirTarefa)
  concluir.current = concluirTarefa

  const canal = useMemo(
    () =>
      new Canal({
        aoMudarEstado: (novo) => {
          setEstado(novo)
          conectadoAgora.current = novo === 'conectado'
          // Conectado já tira o círculo do repouso: a voz ainda vai demorar a abrir,
          // e pode nem abrir, e a tela não pode parecer travada enquanto isso.
          motor.current.fase = novo === 'conectado' ? 'ocioso' : 'offline'
          if (novo === 'conectado') mostrar.current()
        },
        aoMidia: setBase,
        aoTexto: () => {},
        aoFerramenta: (nome) => {
          if (!tarefa.current) return
          atividade.current = atividadeDaFerramenta(nome)
          mostrar.current()
        },
        aoPainel: (painel) => popups.current?.painel(painel),
        aoPopup: (popup) => popups.current?.popup(popup),
        aoTerminar: (texto) => concluir.current(texto),
        aoFalhar: (mensagem) => concluir.current(mensagem),
        aoCredencial: (id, sessao, erro) => popups.current?.credencial(id, sessao, erro),
        aoMedir: (nome, ms, info) => telemetria.current?.registrar(nome, ms, info),
      }),
    [],
  )
  const telemetria = useRef<Telemetria | null>(null)
  if (!telemetria.current) telemetria.current = new Telemetria((eventos) => canal.enviarTelemetria(eventos))

  useEffect(() => {
    void lerPareamento()
      .then((salvo) => {
        if (salvo) {
          setPar(salvo)
          canal.ligar(salvo)
        }
      })
      .finally(() => setCarregado(true))
    const medidor = telemetria.current
    medidor?.ligar()
    const aoMudarDeRede = (nova: NetworkState) => {
      const rede = redeDe(nova)
      if (medidor && rede !== medidor.rede) {
        medidor.rede = rede
        medidor.registrar('rede_mudou', undefined, rede)
      }
    }
    void getNetworkStateAsync().then(aoMudarDeRede).catch(() => {})
    const assinaturaDaRede = addNetworkStateListener(aoMudarDeRede)
    const assinatura = AppState.addEventListener('change', (novo) => {
      medidor?.registrar('app_mudou', undefined, novo)
      if (novo === 'active') {
        canal.retomar()
        popups.current?.ligarVoz()
      }
      // Só com o app na tela: fora dela, o microfone fecha e o indicador some (ADR 0020).
      if (novo === 'background') popups.current?.desligarVoz()
    })
    return () => {
      assinatura.remove()
      assinaturaDaRede.remove()
      medidor?.desligar()
      canal.desligar()
    }
  }, [canal])

  // A voz só faz sentido com o backend ao alcance: sem ele, conversaria normalmente
  // e falharia em toda tarefa.
  const podeOuvir = pagina && estado === 'conectado'
  useEffect(() => {
    if (podeOuvir) popups.current?.ligarVoz()
    else popups.current?.desligarVoz()
  }, [podeOuvir])

  useEffect(() => {
    if (estado === 'conectado') telemetria.current?.descarregar()
  }, [estado])

  useEffect(() => {
    if (!ouvido) return
    opacidadeDoOuvido.setValue(1)
    const sumico = Animated.sequence([
      Animated.delay(OUVIDO_NA_TELA_MS),
      Animated.timing(opacidadeDoOuvido, {
        toValue: 0,
        duration: SUMICO_DO_OUVIDO_MS,
        useNativeDriver: true,
      }),
    ])
    sumico.start(({ finished }) => {
      if (finished) setOuvido('')
    })
    return () => sumico.stop()
  }, [ouvido, opacidadeDoOuvido])

  const aoReceber = (mensagem: MensagemDaPagina) => {
    if (mensagem.fase) {
      if (mensagem.fase !== 'desligada') setAviso('')
      faseDaVoz.current = mensagem.fase
      mostrarFase()
    }
    if (mensagem.ouviu) {
      setOuvido(
        mensagem.ouviu.length > OUVIDO_MAXIMO ? `…${mensagem.ouviu.slice(-OUVIDO_MAXIMO)}` : mensagem.ouviu,
      )
    }
    if (mensagem.medida) {
      telemetria.current?.registrar(mensagem.medida.nome, mensagem.medida.ms, mensagem.medida.info)
    }
    if (mensagem.nivel !== undefined) motor.current.nivel = mensagem.nivel
    if (mensagem.aviso) setAviso(mensagem.aviso)
    if (mensagem.credencial && !canal.pedirCredencial(mensagem.credencial)) {
      popups.current?.credencial(mensagem.credencial, null, 'O computador não está conectado.')
    }
    if (mensagem.cancelar) {
      canal.interromper()
      concluirTarefa('O Ricardo cancelou a tarefa.')
    }
    if (mensagem.tarefa) {
      tarefa.current = mensagem.tarefa
      atividade.current = 'processando'
      mostrarFase()
      popups.current?.novoPedido()
      if (!canal.perguntar(mensagem.pedido ?? '')) {
        concluirTarefa('O computador não está conectado.')
      }
    }
  }

  const parear = (novo: Pareamento) => {
    void salvarPareamento(novo)
    setPar(novo)
    canal.ligar(novo)
  }

  const desparear = () => {
    void apagarPareamento()
    canal.desligar()
    setPar(null)
    setBase(null)
    setPagina(false)
  }

  const conectado = estado === 'conectado'
  const emPareamento = carregado && (!par || estado === 'recusado')

  return (
    <SafeAreaView style={styles.tela} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <Cena motor={motor} />
      {base && !emPareamento && (
        <Popups key={base} ref={popups} base={base} aoCarregar={() => setPagina(true)} aoReceber={aoReceber} />
      )}
      <View style={styles.topo} pointerEvents="box-none">
        <Text style={styles.marca}>A.P.O.L.O.</Text>
        <Pressable onLongPress={desparear} hitSlop={12} disabled={!par}>
          <Text style={[styles.estado, { color: conectado ? COR_DA_INTERFACE : COR_DE_ALERTA }]}>
            {conectado ? 'CONECTADO' : 'DESCONECTADO'}
          </Text>
        </Pressable>
      </View>
      {aviso ? (
        <Text style={styles.aviso} pointerEvents="none">
          {aviso}
        </Text>
      ) : null}
      {!emPareamento && (
        <View style={styles.voz} pointerEvents="none">
          <Animated.Text style={[styles.ouvido, { opacity: opacidadeDoOuvido }]} numberOfLines={3}>
            {ouvido}
          </Animated.Text>
          {conectado && rotulo ? <Text style={styles.rotulo}>{rotulo}</Text> : null}
        </View>
      )}
      {emPareamento && (
        <View style={styles.centro}>
          <TelaDePareamento
            aviso={estado === 'recusado' ? 'O Mac recusou este token.' : undefined}
            aoParear={parear}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Tela />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: COR_DE_FUNDO },
  topo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  marca: { color: COR_DA_INTERFACE, fontFamily: FONTE_MONO, fontSize: 13, letterSpacing: 4 },
  estado: { fontFamily: FONTE_MONO, fontSize: 11, letterSpacing: 2 },
  aviso: {
    color: COR_DO_TEXTO,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  voz: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: '13%',
    alignItems: 'center',
    gap: 12,
  },
  ouvido: { color: COR_DO_TEXTO, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  rotulo: { color: COR_DA_INTERFACE, fontFamily: FONTE_MONO, fontSize: 11, letterSpacing: 3 },
  centro: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
})

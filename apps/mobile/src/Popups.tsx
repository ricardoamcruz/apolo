import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type ComponentType,
  type Ref,
} from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { PAGINA_DE_POPUPS } from './popups.gerado'

/**
 * Os tipos do react-native-webview viram `never` com os do RN 0.88. Declarado à mão
 * só o que este arquivo usa, até o pacote acompanhar.
 */
type WebNativa = { injectJavaScript: (codigo: string) => void }
const Web = WebView as unknown as ComponentType<Record<string, unknown> & { ref: Ref<WebNativa> }>

export type ControleDePopups = {
  painel: (painel: unknown) => void
  popup: (popup: unknown) => void
  novoPedido: () => void
  ligarVoz: () => void
  desligarVoz: () => void
  credencial: (id: string, sessao: unknown, erro?: string) => void
  fimDaTarefa: (id: string, texto: string) => void
  /** O que o core mandou à voz: a resposta de um pedido ou o estado (docs/adr/0030). */
  doCore: (mensagem: unknown) => void
}

/** Um pedido da voz ao core: autodesenvolvimento ou Fênix. Veja src/lib/voz/celular.ts. */
export type PedidoAoCore = { id: string; tipo: 'autodev' | 'fenix'; acao: string } & Record<string, unknown>

/** O que a página manda ao app. Veja src/lib/voz/celular.ts. */
export type MensagemDaPagina = {
  fase?: 'desligada' | 'espera' | 'ouvindo' | 'pensando' | 'ferramenta' | 'falando'
  nivel?: number
  ouviu?: string
  fim?: boolean
  medida?: { nome: string; ms?: number; info?: string }
  aviso?: string
  credencial?: string
  tarefa?: string
  pedido?: string
  cancelar?: boolean
  core?: PedidoAoCore
}

type Props = {
  /** Endereço de mídia do gateway, sem barra no fim. */
  base: string
  aoCarregar: () => void
  aoReceber: (mensagem: MensagemDaPagina) => void
}

/** Por expressão regular porque o `URL` do React Native não é completo. */
const origemDe = (base: string) => /^https?:\/\/[^/]+/.exec(base)?.[0] ?? base

/** A página só carrega desta origem, e o resto é o que o sanitizador da web já exige. */
function pagina(base: string) {
  const origem = origemDe(base)
  const politica = [
    "default-src 'none'",
    // blob: é o AudioWorklet que captura o microfone.
    "script-src 'unsafe-inline' blob:",
    'connect-src wss://generativelanguage.googleapis.com',
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com data:',
    `img-src ${origem} data: blob:`,
    `media-src ${origem} blob:`,
    `frame-src ${origem} https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com`,
  ].join('; ')
  const cabecalho =
    `<meta http-equiv="Content-Security-Policy" content="${politica}">` +
    `<script>globalThis.__APOLO_PONTE__=${JSON.stringify(base)}</script>`
  return PAGINA_DE_POPUPS.replace('<!--APOLO_CABECALHO-->', () => cabecalho)
}

/** Os popups e a voz da web, em cima da cena. Veja src/popups.tsx. */
export const Popups = forwardRef<ControleDePopups, Props>(function Popups(
  { base, aoCarregar, aoReceber },
  ref,
) {
  const web = useRef<WebNativa>(null)
  const pronta = useRef(false)
  const fila = useRef<string[]>([])
  const fonte = useMemo(() => ({ html: pagina(base), baseUrl: `${origemDe(base)}/` }), [base])

  const executar = (codigo: string) => {
    if (pronta.current) web.current?.injectJavaScript(`${codigo};true`)
    else fila.current.push(codigo)
  }
  const chamar = (metodo: string, ...args: unknown[]) =>
    executar(`window.${metodo}(${args.map((a) => JSON.stringify(a ?? null)).join(',')})`)

  useImperativeHandle(ref, () => ({
    painel: (painel) => chamar('apoloPopups.painel', painel),
    popup: (popup) => chamar('apoloPopups.popup', popup),
    novoPedido: () => chamar('apoloPopups.novoPedido'),
    ligarVoz: () => chamar('apoloVoz.ligar'),
    desligarVoz: () => chamar('apoloVoz.desligar'),
    credencial: (id, sessao, erro) => chamar('apoloVoz.credencial', id, sessao, erro),
    fimDaTarefa: (id, texto) => chamar('apoloVoz.fimDaTarefa', id, texto),
    doCore: (mensagem) => chamar('apoloVoz.doCore', mensagem),
  }))

  return (
    <View style={StyleSheet.absoluteFill}>
      <Web
        ref={web}
        source={fonte}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={['*']}
        opaque={false}
        scrollEnabled={false}
        bounces={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        // Um link no popup não pode trocar a página inteira: só os iframes navegam.
        onShouldStartLoadWithRequest={({ isTopFrame, url }: { isTopFrame: boolean; url: string }) =>
          !isTopFrame || url === fonte.baseUrl || url === 'about:blank'
        }
        onLoadEnd={() => {
          pronta.current = true
          fila.current.splice(0).forEach(executar)
          aoCarregar()
        }}
        onMessage={({ nativeEvent }: { nativeEvent: { data: string } }) =>
          aoReceber(JSON.parse(nativeEvent.data))
        }
      />
    </View>
  )
})

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: 'transparent' },
})

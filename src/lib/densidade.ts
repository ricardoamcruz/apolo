/**
 * A densidade de pixels da tela, para o canvas desenhar na resolução real dela.
 *
 * Um canvas tem dois tamanhos: o do buffer, em pixels de verdade, e o do
 * elemento, em pixels de CSS. Quando o buffer é menor que a tela, o navegador
 * amplia a imagem na hora de compor a página — e ampliar uma imagem de pontos
 * de luz é exatamente o que borra o reator. Num iPhone, de densidade 3, um
 * buffer feito para densidade 2 chega à tela esticado em 50%.
 *
 * A fonte é `window.devicePixelRatio`, que já é a conta pronta: quantos pixels
 * da tela cabem num pixel de CSS. Ele muda em vida — zoom do navegador, janela
 * arrastada para outro monitor — então quem desenha precisa ser avisado.
 */

/**
 * Acima disto, nitidez não se vê e o custo é real: o número de pixels cresce com
 * o quadrado da densidade, e a cena tem bloom, que redesenha o quadro inteiro
 * várias vezes. 3 é a densidade de um iPhone Retina, a maior tela de verdade
 * que o A.P.O.L.O. encontra; 2 é a do Mac.
 */
export const DENSIDADE_MAXIMA = 3

/** A densidade de agora, limitada ao que vale a pena desenhar. */
export function densidadeDaTela(): number {
  const bruta = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.min(Math.max(bruta, 1), DENSIDADE_MAXIMA)
}

/**
 * Avisa quando a densidade da tela muda, e devolve como parar de ouvir.
 *
 * Não existe evento de "mudou a densidade": o que existe é uma media query que
 * pergunta por um valor exato. Então a consulta é feita para a densidade de
 * agora e deixa de casar justamente quando a tela muda — aí ela é refeita com o
 * valor novo. `resize` não serve sozinho: no celular, girar o aparelho dispara
 * `resize` sem mudar a densidade, e o zoom no desktop muda a densidade sem
 * mudar o tamanho da janela.
 */
export function aoMudarDensidade(aviso: (densidade: number) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  let consulta: MediaQueryList | null = null
  let ouvindo = true

  function observar() {
    consulta?.removeEventListener('change', aoMudar)
    consulta = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    consulta.addEventListener('change', aoMudar)
  }

  function aoMudar() {
    if (!ouvindo) return
    observar()
    aviso(densidadeDaTela())
  }

  observar()
  return () => {
    ouvindo = false
    consulta?.removeEventListener('change', aoMudar)
    consulta = null
  }
}

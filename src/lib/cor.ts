/**
 * A cor de alerta: a mais contrastante com a cor da interface no momento.
 *
 * A interface muda de cor por fase e por pedido, então um vermelho fixo some
 * justamente quando ela fica vermelha. O alerta é o oposto no círculo cromático,
 * saturado e claro o bastante para ler sobre o fundo escuro.
 */

const paraRgb = (hex: string) => {
  const h = hex.replace('#', '')
  const cheio = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16) / 255)
}

function paraHsl([r, g, b]: number[]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}

function paraHex(h: number, s: number, l: number) {
  const canal = (n: number) => {
    const k = (n + h / 30) % 12
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${canal(0)}${canal(8)}${canal(4)}`
}

/** Luminância relativa do WCAG. */
function luminancia(hex: string) {
  const [r, g, b] = paraRgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** O mínimo para texto pequeno ler bem sobre o fundo escuro: o azul puro não chega. */
const LUMINANCIA_MINIMA = 0.35

/** Abaixo disto, a cor é quase cinza: ela não tem matiz para inverter. */
const QUASE_CINZA = 0.12
const AMBAR = 32

export function contrastante(hex: string) {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i.test(hex)) return paraHex(AMBAR, 1, 0.66)
  const { h, s } = paraHsl(paraRgb(hex))
  const matiz = s < QUASE_CINZA ? AMBAR : (h + 180) % 360
  // Clareia sem mudar o matiz, porque o oposto de um amarelo é um azul escuro.
  let l = 0.66
  while (luminancia(paraHex(matiz, 1, l)) < LUMINANCIA_MINIMA && l < 0.9) l += 0.01
  return paraHex(matiz, 1, l)
}

/**
 * A cor pedida à interface pode ser qualquer CSS ("gold", "rgb(...)"). O próprio
 * navegador a converte, e o resultado é hexadecimal para cores opacas.
 */
export function corEmHex(css: string) {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return css
  ctx.fillStyle = css
  return ctx.fillStyle
}

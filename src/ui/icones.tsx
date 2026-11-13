import type { ReactNode } from 'react'

/**
 * Os ícones do A.P.O.L.O. e dos módulos (ADR 0013 revisada, escolha de 12/11/2026):
 * a Lira é a marca; Processador, Asas, Asa e Sol nascente são o C.O.R.E., a
 * F.Ê.N.I.X., o H.E.R.M.E.S. e a A.U.R.O.R.A. na aba SISTEMAS.
 *
 * Traço de 1,6 em 24 × 24, na cor de quem os desenha (`currentColor`): seguem o
 * estado como o resto do HUD. Desenhados para ler a 16 px. O favicon
 * (public/favicon.svg) repete a Lira com a cor escrita, porque o navegador não
 * aplica CSS a ele.
 */

const tracos = (corpo: ReactNode, titulo: string, className?: string) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label={titulo}
  >
    {corpo}
  </svg>
)

/** A marca: a lira de Apolo, a voz e a música. */
export const Lira = ({ className }: { className?: string }) =>
  tracos(
    <>
      <path d="M4.5 3.5C4.5 7 8 8 8 11.5V17" />
      <path d="M19.5 3.5C19.5 7 16 8 16 11.5V17" />
      <path d="M8 17c0 2 1.8 3.5 4 3.5s4-1.5 4-3.5z" />
      <path d="M6 6.5h12" />
      <path d="M10.5 6.5V17M13.5 6.5V17" />
    </>,
    'A.P.O.L.O.',
    className,
  )

const DESENHOS: Record<string, { titulo: string; corpo: ReactNode }> = {
  /** C.O.R.E.: o processador, "é a máquina dele". */
  core: {
    titulo: 'C.O.R.E.',
    corpo: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
      </>
    ),
  },
  /** F.Ê.N.I.X.: a ave de asas abertas, com a cauda em chama. */
  fenix: {
    titulo: 'F.Ê.N.I.X.',
    corpo: (
      <>
        <path d="M12 12.5C10 8.5 7 6.5 3 6.5c1 4 4 7 9 8" />
        <path d="M12 12.5c2-4 5-6 9-6-1 4-4 7-9 8" />
        <circle cx="12" cy="9" r="1.3" />
        <path d="M12 15c-1.4 1.8-1.4 3.8 0 5.5 1.4-1.7 1.4-3.7 0-5.5z" />
      </>
    ),
  },
  /** H.E.R.M.E.S. (o canal do celular, id `celular`): a asa do mensageiro. */
  celular: {
    titulo: 'H.E.R.M.E.S.',
    corpo: (
      <>
        <path d="M3.5 18.5C7.5 11.5 13 7.5 20.5 5.5L16 10.2l3.6-.4-4.8 4.1 3-.1-6.3 3.6z" />
        <path d="M3.5 18.5l8-2.6" />
      </>
    ),
  },
  /** A.U.R.O.R.A.: o sol saindo do horizonte. */
  aurora: {
    titulo: 'A.U.R.O.R.A.',
    corpo: (
      <>
        <path d="M3 17h18" />
        <path d="M7 17a5 5 0 0 1 10 0" />
        <path d="M12 7v2.5M5.6 10.4l1.8 1.5M18.4 10.4l-1.8 1.5M2.5 14h2M19.5 14h2" />
        <path d="M8 20.5h8" />
      </>
    ),
  },
}

/** O ícone de um sistema da aba SISTEMAS, pelo id (`core`, `fenix`, `celular`, `aurora`), ou null. */
export function IconeDoSistema({ id, className }: { id: string; className?: string }) {
  const d = DESENHOS[id]
  return d ? tracos(d.corpo, d.titulo, className) : null
}

/** Os ids que têm ícone, para os testes cobrarem um por sistema plugável. */
export const SISTEMAS_COM_ICONE = Object.keys(DESENHOS)

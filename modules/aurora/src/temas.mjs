/**
 * Os temas de notícia do bom dia, editáveis por voz ("tira games do bom dia").
 *
 * O aurora.config.json continua sendo o padrão, versionado no repositório; o que o
 * Ricardo muda falando fica fora dele, num arquivo da pasta da A.U.R.O.R.A.
 * (AURORA_PASTA/noticias.json), como as preferências de exibição do A.P.O.L.O.
 * (RF-57). Isso não é detalhe: escrever no arquivo do repositório deixaria a cópia
 * em execução suja, e cópia suja barra troca de branch e autodesenvolvimento.
 *
 * "Restaurar" apaga a escolha e o padrão do repositório volta a valer.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const TEMAS_MAX = 8
const NOME_MAX = 60
const BUSCA_MAX = 160
const POR_TEMA_MAX = 5

/** Sem acento e sem maiúscula: "games" acha "Games e cultura pop". */
const simples = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

const limpo = (t, max) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const valido = (t) => t && typeof t.nome === 'string' && typeof t.busca === 'string'

export function criarTemas({ pasta, config, arquivo = join(pasta ?? '.', 'noticias.json') }) {
  const padrao = {
    temas: (config?.noticias?.temas ?? []).filter(valido).map(({ nome, busca }) => ({ nome, busca })),
    porTema: config?.noticias?.porTema ?? 3,
  }
  let escolha = null
  try {
    const salvo = JSON.parse(readFileSync(arquivo, 'utf8'))
    escolha = {
      temas: Array.isArray(salvo.temas) ? salvo.temas.filter(valido).map(({ nome, busca }) => ({ nome, busca })) : padrao.temas,
      porTema: Number.isInteger(salvo.porTema) ? salvo.porTema : padrao.porTema,
    }
  } catch {
    /* ninguém mudou nada ainda, ou o arquivo está ilegível: vale o padrão */
  }

  const estado = () => escolha ?? padrao
  const gravar = (novo) => {
    escolha = novo
    mkdirSync(dirname(arquivo), { recursive: true })
    writeFileSync(arquivo, JSON.stringify(novo, null, 2))
  }

  const nomes = () => estado().temas.map((t) => t.nome)
  const listados = () => (nomes().length ? nomes().join(', ') : 'nenhum')

  return {
    /** Os temas que o bom dia vai buscar agora. */
    lista: () => estado().temas,
    porTema: () => estado().porTema,
    /** O que a voz lê: os temas, quantas notícias por tema e se é o padrão. */
    estado: () => ({ ...estado(), padrao: escolha === null }),

    /**
     * Uma edição por vez: tirar um tema, incluir um tema, mudar quantas notícias
     * por tema ou voltar ao padrão. Devolve { ok, mensagem, temas, porTema }.
     */
    editar({ tirar, incluir, porTema, restaurar } = {}) {
      const feito = (mensagem) => ({ ok: true, mensagem, ...estado() })

      if (restaurar) {
        escolha = null
        try {
          rmSync(arquivo, { force: true })
        } catch {
          /* se não der para apagar, o padrão já voltou a valer nesta sessão */
        }
        return feito(`Voltei aos temas de sempre: ${listados()}.`)
      }

      if (typeof tirar === 'string' && tirar.trim()) {
        const busca = simples(tirar)
        const atual = estado()
        const achado = atual.temas.find((t) => simples(t.nome).includes(busca) || simples(t.busca).includes(busca))
        if (!achado) return { ok: false, mensagem: `Não tenho tema com "${tirar.trim()}". Os temas de hoje: ${listados()}.`, ...atual }
        gravar({ ...atual, temas: atual.temas.filter((t) => t !== achado) })
        return feito(`Tirei ${achado.nome} do bom dia. Ficaram: ${listados()}.`)
      }

      if (incluir) {
        const nome = limpo(incluir.nome, NOME_MAX)
        const busca = limpo(incluir.busca, BUSCA_MAX) || nome
        const atual = estado()
        if (!nome) return { ok: false, mensagem: 'Para incluir um tema, diga o nome dele.', ...atual }
        if (atual.temas.some((t) => simples(t.nome) === simples(nome))) {
          return { ok: false, mensagem: `${nome} já está no bom dia.`, ...atual }
        }
        if (atual.temas.length >= TEMAS_MAX) {
          return { ok: false, mensagem: `Já são ${TEMAS_MAX} temas, o máximo. Tire um antes de incluir outro.`, ...atual }
        }
        gravar({ ...atual, temas: [...atual.temas, { nome, busca }] })
        return feito(`Incluí ${nome} no bom dia. Agora são: ${listados()}.`)
      }

      if (porTema !== undefined) {
        const n = Number(porTema)
        if (!Number.isInteger(n) || n < 1 || n > POR_TEMA_MAX) {
          return { ok: false, mensagem: `Posso trazer de 1 a ${POR_TEMA_MAX} notícias por tema.`, ...estado() }
        }
        gravar({ ...estado(), porTema: n })
        return feito(`Agora são ${n} notícia${n === 1 ? '' : 's'} por tema.`)
      }

      return { ok: false, mensagem: 'Diga o que mudar nos temas: tirar, incluir, quantas por tema ou voltar ao padrão.', ...estado() }
    },
  }
}

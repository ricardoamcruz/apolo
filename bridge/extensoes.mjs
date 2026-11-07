/**
 * Ponto de extensão entre os dispositivos (docs/adr/0022).
 *
 * Uma extensão futura vai deixar o A.P.O.L.O. levar um comando do celular ao PC, à
 * web ou ao servidor, e de volta. Este arquivo é só a tomada: sabe quem está
 * conectado e leva mensagens até a extensão certa. Sem nenhuma registrada, tudo o
 * que chega é descartado.
 *
 * A central não decide nada sobre o conteúdo. Quem executar algo por causa de uma
 * mensagem daqui continua obrigado a passar pelo gate: ter um aparelho conectado não
 * é permissão para agir.
 *
 * Arquivo sensível (bridge/autodev/politica.mjs): só muda por revisão humana.
 */

const NOME = /^[a-z][a-z0-9_-]{0,31}$/
export const MAX_BYTES = 64 * 1024

export function criarCentral() {
  const extensoes = new Map()
  const dispositivos = new Map()
  let proximo = 0

  const empacotar = (extensao, dados) => ({ type: 'extensao', extensao, dados })

  /** O que uma extensão pode fazer com a central. Não é mais que isto. */
  const apiPara = (extensao) => ({
    dispositivos: () => [...dispositivos.values()].map(({ id, tipo }) => ({ id, tipo })),
    /** `destino` é o id de um dispositivo ou um tipo ('web', 'celular'). */
    enviar: (destino, dados) => {
      let entregues = 0
      for (const d of dispositivos.values()) {
        if (d.id !== destino && d.tipo !== destino) continue
        d.enviar(empacotar(extensao, dados))
        entregues++
      }
      return entregues
    },
  })

  return {
    /** @param {{ id: string, aoMensagem: Function }} extensao */
    registrar: ({ id, aoMensagem }) => {
      if (!NOME.test(id ?? '')) throw new Error('nome de extensão inválido')
      if (extensoes.has(id)) throw new Error(`a extensão ${id} já está registrada`)
      extensoes.set(id, { aoMensagem, api: apiPara(id) })
    },

    /** Chamado por conexão. `tipo` diz o que é o aparelho; `enviar` fala com ele. */
    conectar: ({ tipo, enviar }) => {
      const id = `${tipo}-${++proximo}`
      dispositivos.set(id, { id, tipo, enviar })
      return {
        id,
        receber: (mensagem) => {
          const extensao = extensoes.get(mensagem?.extensao)
          if (!extensao) return false
          if (JSON.stringify(mensagem.dados ?? null).length > MAX_BYTES) return false
          extensao.aoMensagem({ de: { id, tipo }, dados: mensagem.dados }, extensao.api)
          return true
        },
        sair: () => dispositivos.delete(id),
      }
    },

    registradas: () => [...extensoes.keys()],
  }
}

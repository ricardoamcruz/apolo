import { useState, type FormEvent } from 'react'
import { useStore } from '../store'
import { autodev } from '../lib/bridge'

const FASES = {
  proposto: 'AGUARDANDO CONFIRMAÇÃO',
  trabalhando: 'ALTERANDO O CÓDIGO',
  verificando: 'VERIFICANDO',
  aplicando: 'REINICIANDO',
  testando: 'EM TESTE',
} as const

/**
 * O chat de desenvolvimento e o acompanhamento do trabalho em andamento.
 *
 * Mesmo caminho da voz: o texto digitado vira uma proposta, e nada roda sem
 * confirmação. Só aparece com o autodesenvolvimento ligado.
 */
export function Autodev() {
  const estado = useStore((s) => s.autodev)
  const phase = useStore((s) => s.phase)
  const exibirPonte = useStore((s) => s.exibicao.exibirPonte)
  const setError = useStore((s) => s.setError)
  const [pedido, setPedido] = useState('')

  if (!estado?.ligado || phase === 'offline' || phase === 'boot') return null
  // Oculto só em repouso: com proposta ou teste em aberto, o botão tem de existir.
  if (estado.fase === 'ocioso' && !exibirPonte) return null

  const agir = async (acao: string, extra?: { pedido: string }) => {
    try {
      const r = await autodev(acao, extra)
      if (!r.ok) setError(r.mensagem)
      return r.ok
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const texto = pedido.trim()
    if (texto && (await agir('propor', { pedido: texto }))) setPedido('')
  }

  const { fase, resultado } = estado
  return (
    <section className="autodev">
      {fase !== 'ocioso' && (
        <>
          <div className="autodev-fase">
            {fase !== 'proposto' && fase !== 'testando' && <span className="spinner" />}
            {FASES[fase]}
          </div>
          <div className="autodev-pedido">{estado.pedido}</div>
          {estado.etapa && <div className="autodev-etapa">{estado.etapa}</div>}
          {fase === 'testando' && resultado?.tipo === 'recusado' && (
            <div className="autodev-resultado autodev-recusado">{resultado.mensagem}</div>
          )}
          <div className="autodev-acoes">
            {fase === 'proposto' && <button onClick={() => void agir('confirmar')}>Confirmar</button>}
            {(fase === 'proposto' || fase === 'trabalhando') && (
              <button onClick={() => void agir('cancelar')}>Cancelar</button>
            )}
            {fase === 'testando' && <button onClick={() => void agir('aprovar')}>Aprovar</button>}
            {fase === 'testando' && <button onClick={() => void agir('reverter')}>Descartar</button>}
          </div>
        </>
      )}
      {fase === 'ocioso' && resultado && (
        <div className={`autodev-resultado autodev-${resultado.tipo}`}>
          {resultado.mensagem}
          {resultado.branch && <div className="autodev-etapa">{resultado.branch}</div>}
        </div>
      )}
      {fase === 'ocioso' && (
        <form onSubmit={(e) => void enviar(e)}>
          <input
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            placeholder="pedir uma alteração no meu código"
            aria-label="Pedir uma alteração no código do A.P.O.L.O."
          />
        </form>
      )}
    </section>
  )
}

import { useStore } from '../store'
import { fenix } from '../lib/bridge'

/**
 * Os scripts que a F.Ê.N.I.X. propôs e que esperam o Ricardo (ADR 0025).
 *
 * Aparece sempre que houver proposta, mesmo com a ponte oculta: um pedido de
 * confirmação sem botão seria uma ordem que só a voz conseguiria dar (RF-57).
 * O clique é dele, então não passa pela conferência da fala.
 */
export function Fenix() {
  const propostas = useStore((s) => s.fenix.propostas)
  const phase = useStore((s) => s.phase)
  const setError = useStore((s) => s.setError)
  if (!propostas.length || phase === 'offline') return null

  const agir = async (acao: 'confirmar' | 'cancelar', id: string) => {
    const r = await fenix(acao, { proposta: id }, 6 * 60_000)
    if (!r.ok) setError(r.mensagem)
  }

  return (
    <section className="fenix-propostas" aria-label="Comandos da F.Ê.N.I.X. esperando confirmação">
      {propostas.map((p) => (
        <div key={p.id} className="fenix-proposta">
          <div className="autodev-fase">F.Ê.N.I.X. · AGUARDANDO CONFIRMAÇÃO</div>
          {p.motivo && <div className="autodev-etapa">{p.motivo}</div>}
          <pre className="fenix-script">{p.script}</pre>
          <div className="autodev-acoes">
            <button onClick={() => void agir('confirmar', p.id)}>Confirmar</button>
            <button onClick={() => void agir('cancelar', p.id)}>Cancelar</button>
          </div>
        </div>
      ))}
    </section>
  )
}

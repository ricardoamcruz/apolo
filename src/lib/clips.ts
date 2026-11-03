/**
 * Frases pré-gravadas com a voz própria (ADR 0008).
 *
 * `npm run voz:gerar` grava as frases fixas em public/audio/voz/ e escreve o
 * manifest.json lido aqui. Uma frase cujo texto bate com uma gravação toca o
 * arquivo; qualquer outra segue para a voz do sistema. Sem manifesto (pasta não
 * gerada nesta máquina), nada muda: tudo sai na voz do sistema.
 *
 * Este arquivo também é importado pelo script, em Node — por isso nada aqui
 * toca o navegador fora de `loadClips`.
 */

export type ClipManifest = {
  /** Perfil de voz que gravou os arquivos. */
  voice: string
  generatedAt: string
  /** clipKey(frase) → nome do arquivo em public/audio/voz/. */
  clips: Record<string, string>
}

/** A mesma frase com outra caixa ou espaçamento é a mesma gravação. A
 *  pontuação conta: "Sim?" e "Sim." têm entonações diferentes. */
export function clipKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

let manifest: ClipManifest | null = null

/** Busca o manifesto uma vez. Falhar é normal (voz não gerada) e silencioso. */
export async function loadClips(base: string): Promise<void> {
  try {
    const res = await fetch(`${base}audio/voz/manifest.json`, { cache: 'no-cache' })
    if (!res.ok) return
    const m = (await res.json()) as ClipManifest
    manifest = { ...m, clips: Object.fromEntries(Object.entries(m.clips).map(([k, f]) => [k, `${base}audio/voz/${f}`])) }
  } catch {
    /* sem voz própria nesta máquina */
  }
}

/** URL da gravação desta frase, se houver. */
export function clipFor(text: string): string | null {
  return manifest?.clips[clipKey(text)] ?? null
}

/** Nome do perfil que gravou as frases, para o painel de diagnóstico. */
export function clipVoice(): string {
  return manifest?.voice ?? ''
}

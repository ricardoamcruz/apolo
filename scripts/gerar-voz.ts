/**
 * Pré-grava as frases fixas do A.P.O.L.O. com a voz própria.
 *
 * A voz própria (perfil do VoiceStudio, ADR 0008) leva ~30 s para gerar cada
 * frase em CPU — impossível em conversa, ótimo uma vez só. Este script grava
 * cada frase de FIXED_PHRASES em public/audio/voz/ e escreve um manifest.json
 * que tts.ts consulta: frase com arquivo toca o arquivo, o resto sai na voz do
 * sistema.
 *
 * Incremental: frases já gravadas com a mesma voz são puladas. Use --tudo para
 * regravar todas (por exemplo, depois de ajustar o perfil no VoiceStudio).
 *
 *   npm run voz:gerar
 *
 * Configuração em .env.local (ver .env.example):
 *   VOICESTUDIO_URL      endereço do VoiceStudio (padrão http://127.0.0.1:3900)
 *   VOICESTUDIO_API_KEY  chave da API (OMNIVOICE_API_KEY do container)
 *   VOICESTUDIO_VOICE    perfil de voz (padrão Apolo_v01)
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { FIXED_PHRASES } from '../src/lib/fillers.ts'
import { clipKey, type ClipManifest } from '../src/lib/clips.ts'

const BASE = (process.env.VOICESTUDIO_URL ?? 'http://127.0.0.1:3900').replace(/\/+$/, '')
const KEY = process.env.VOICESTUDIO_API_KEY ?? ''
const VOICE = process.env.VOICESTUDIO_VOICE ?? 'Apolo_v01'
const OUT = 'public/audio/voz'
const MANIFEST = join(OUT, 'manifest.json')
/** Uma frase em CPU leva até ~45 s; a primeira ainda carrega o modelo. */
const TIMEOUT_MS = 300_000

function load(): ClipManifest {
  try {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as ClipManifest
    // Outra voz: nada do que está gravado serve.
    if (m.voice === VOICE) return m
  } catch {
    /* sem manifesto ainda */
  }
  return { voice: VOICE, generatedAt: '', clips: {} }
}

async function synthesise(text: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'omnivoice', voice: VOICE, input: text, response_format: 'mp3' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  if (!KEY) {
    console.error('Falta VOICESTUDIO_API_KEY no .env.local (ver .env.example).')
    process.exit(1)
  }
  const all = process.argv.includes('--tudo')
  mkdirSync(OUT, { recursive: true })
  const manifest = all ? { voice: VOICE, generatedAt: '', clips: {} } : load()

  const todo = FIXED_PHRASES.filter((p) => {
    const file = manifest.clips[clipKey(p)]
    return !file || !existsSync(join(OUT, file))
  })
  console.log(`Voz ${VOICE} em ${BASE}: ${todo.length} de ${FIXED_PHRASES.length} frases a gravar.`)

  let failed = 0
  for (const [i, phrase] of todo.entries()) {
    const key = clipKey(phrase)
    const file = `${createHash('sha1').update(`${VOICE}\n${key}`).digest('hex').slice(0, 12)}.mp3`
    const t0 = Date.now()
    try {
      writeFileSync(join(OUT, file), await synthesise(phrase))
      manifest.clips[key] = file
      manifest.generatedAt = new Date().toISOString()
      // Salvo a cada frase: interromper no meio não perde o que já foi gravado.
      writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
      console.log(`  [${i + 1}/${todo.length}] ${((Date.now() - t0) / 1000).toFixed(0)} s  ${phrase}`)
    } catch (err) {
      failed++
      console.error(`  [${i + 1}/${todo.length}] falhou: ${phrase} — ${(err as Error).message}`)
    }
  }
  console.log(failed ? `Concluído com ${failed} falha(s); rode de novo para tentar só elas.` : 'Concluído.')
  if (failed) process.exitCode = 1
}

await main()

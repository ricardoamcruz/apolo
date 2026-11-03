#!/usr/bin/env node
// Verificação do A.P.O.L.O. — rode com `npm run setup`.
//
// Não muda nem instala nada. Olha a máquina, diz o que está pronto e o que
// falta, e mostra como iniciar. Sempre termina com sucesso: é conselho, não
// uma barreira.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ok = '  ok  ';
const warn = ' nota ';
const info = '  ·   ';
const line = (tag, msg) => console.log(`[${tag}] ${msg}`);

console.log('');
console.log('A.P.O.L.O. — verificando a máquina (nada é alterado)');
console.log('----------------------------------------------------');

// --- Node -----------------------------------------------------------------
const major = Number(process.versions.node.split('.')[0]);
if (major >= 21) line(ok, `Node.js ${process.versions.node}.`);
else line(warn, `Node.js ${process.versions.node} é antigo. Atualize para o 22 ou mais novo.`);

// --- Claude CLI (agente de tarefas) -----------------------------------------
const claude = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
if (claude.status === 0 && claude.stdout) {
  line(ok, `Claude Code encontrado: ${claude.stdout.trim()} (agente de tarefas).`);
} else {
  line(warn, 'Claude Code não encontrado. Ele é o agente de tarefas (internet, e-mail, navegador).');
  line(info, 'Instale com: npm install -g @anthropic-ai/claude-code e rode `claude` uma vez para entrar.');
}

// --- Servidores MCP ---------------------------------------------------------
try {
  const parsed = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
  const n = Object.keys(parsed?.mcpServers ?? {}).length;
  line(n ? ok : info, n ? `${n} servidor(es) MCP configurado(s).` : 'Nenhum servidor MCP configurado ainda.');
} catch {
  line(info, '~/.claude.json ainda não existe — aparece depois do primeiro login no Claude Code.');
}

// --- Chave da voz em tempo real -------------------------------------------
let envFile = '';
try {
  envFile = readFileSync('.env.local', 'utf8');
} catch {
  /* sem .env.local */
}
const has = (name) =>
  Boolean(process.env[name]?.trim()) || new RegExp(`^\\s*${name}\\s*=\\s*\\S+`, 'm').test(envFile);
if (has('GEMINI_API_KEY')) line(ok, 'Chave do Gemini encontrada — a voz em tempo real vai usar o Gemini Live.');
else if (has('OPENAI_API_KEY')) line(ok, 'Chave da OpenAI encontrada — a voz vai usar a OpenAI Realtime (paga).');
else {
  line(warn, 'Falta a chave da voz. Sem ela, ele não fala.');
  line(info, 'Crie uma gratuita em https://aistudio.google.com/apikey e coloque no .env.local:');
  line(info, '  GEMINI_API_KEY=...');
}

console.log('');
console.log('Para iniciar:  npm start   (abra no Chrome o endereço que aparecer)');
console.log('Clique em INICIAR, ou bata palmas, e fale normalmente.');
console.log('Para liberar ações reais (enviar, clicar, apagar):  npm start -- --writes');
console.log('');
process.exit(0);

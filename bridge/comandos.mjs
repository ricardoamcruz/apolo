/**
 * Tudo o que tem tecla também tem fala (RF-20, docs/adr/0023).
 *
 * Esta lista é o que o A.P.O.L.O. explica quando o Ricardo esquece um comando, e o
 * teste confere que nenhuma tecla ficou de fora. Tecla nova entra aqui.
 */

export const COMANDOS = [
  { tecla: 'Espaço', faz: 'interrompe a fala dele', fala: '"para", "chega", "silêncio"', celular: true },
  { tecla: 'Espaço', faz: 'acorda da espera', fala: 'chamar "Apolo"; no celular, também tocar na tela', celular: true },
  { tecla: 'Esc', faz: 'entra em espera', fala: '"em espera", "já volto"', celular: true },
  { tecla: 'Esc', faz: 'cancela a tarefa em andamento', fala: '"cancela", "cancela a tarefa", "deixa pra lá"', celular: true },
  { tecla: 'G', faz: 'liga ou desliga o modo mãos', fala: '"ligar modo mãos", "desligar a câmera"', celular: false },
  { tecla: 'D', faz: 'abre o diagnóstico completo', fala: '"diagnóstico completo", "fechar diagnóstico"', celular: false },
  { tecla: ']', faz: 'vai para o próximo popup', fala: '"próximo popup"', celular: true },
  { tecla: '[', faz: 'volta ao popup anterior', fala: '"popup anterior"', celular: true },
  { tecla: 'E', faz: 'põe o popup em tela cheia, ou sai dela', fala: '"tela cheia", "sair da tela cheia"', celular: true },
  { tecla: 'X', faz: 'fecha o popup da frente', fala: '"fechar este popup"', celular: true },
]

/** A lista como o modelo de voz a recebe. No celular, só o que existe lá. */
export const textoDosComandos = ({ celular = false } = {}) =>
  COMANDOS.filter((c) => !celular || c.celular)
    .map((c) => `- ${c.faz}: ${c.fala}`)
    .join('\n')

# Â.N.C.O.R.A. — Agora Nós Conheceremos O Retrocesso Automático

O pânico do A.P.O.L.O. (docs/adr/0041). Desliga tudo, guarda o que estava sem
commit numa branch `panico/<data-hora>`, põe no ar a versão de segurança (a
âncora) e confere que tudo subiu. Não importa nada do projeto: roda mesmo com o
repositório, a Fênix e a `main` quebrados.

## Instalar (uma vez)

Dois cliques em `scripts/ancora/instalar.command`, ou:

```bash
sudo node scripts/ancora/ancora.mjs instalar   # pede a palavra-senha do Atalho
sudo ancora --atualizar main                   # congela a primeira âncora
```

O que fica instalado, tudo do `root`:

| Onde | O quê |
|---|---|
| `/usr/local/bin/ancora` | o comando |
| `/usr/local/ancora/bin/ancora.mjs` | o programa (este arquivo, na versão da âncora) |
| `/usr/local/ancora/ancora.conf` | portas, saúde dos serviços, tópico do ntfy, palavra-senha |
| `/usr/local/ancora/<N>/` | a âncora congelada, com `ANCORA.json` e `MANIFESTO` |
| `/Library/LaunchAgents/com.apolo.ancora.vigia.plist` | o vigia do iPhone |
| `~/Desktop/Âncora.command` | dois cliques para o pânico |

O que é seu, em `~/.apolo/ancora/`: `registro.log`, `vigia.log`, `no-ar.json`, a
cópia ativa (`ativa/`) e o arquivo do que o pânico guardou (`arquivo/`).

Mudar `scripts/ancora/` no repositório não muda o que está instalado: só um novo
`sudo ancora --atualizar <commit>` troca o programa pelo daquele commit, que tem de
estar na `main` do GitHub.

## Usar

```bash
ancora                  # o pânico
ancora --estado         # qual âncora está instalada e se está no ar
ancora --sair           # desliga a âncora e sobe a main do repositório
ancora --testar-atalho  # o código que o Atalho do iPhone deve mandar agora
```

Pela voz, no PC e no app do iPhone: "protocolo âncora" (com o sim).

## O Atalho do iPhone

O Atalho manda um código que vale um minuto, e a palavra-senha nunca passa pelo
ntfy. No app Atalhos, crie "Âncora" com estas ações:

1. **Data atual**.
2. **Formatar data**: formato personalizado `yyyyMMddHHmm`.
3. **Texto**: `<sua palavra-senha>:` seguido da data formatada (sem espaços).
4. **Gerar hash**: SHA256 do texto.
5. **Obter conteúdo do URL**: `https://ntfy.sh/<seu tópico>-ancora`, método POST,
   corpo de solicitação "Arquivo" com o hash.

Confira com `ancora --testar-atalho` no mesmo minuto: os dois códigos têm de ser
iguais. O vigia aceita um pedido a cada 10 minutos, nunca o mesmo código duas
vezes, e registra tudo em `~/.apolo/ancora/registro.log`.

## Testes

`npm run test:ancora` roda o pânico inteiro numa pasta temporária, sem `root` e
sem tocar no A.P.O.L.O. que está no ar.

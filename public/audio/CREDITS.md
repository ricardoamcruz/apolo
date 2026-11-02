# Audio credits

All three tracks are by **Kevin MacLeod** (incompetech.com), licensed
**Creative Commons Attribution 4.0**. Free to use commercially — including in a
monetised YouTube video — provided the attribution below appears somewhere the
audience can see it (a description box is fine).

| File | Track | Used for |
|---|---|---|
| `ambient.mp3` | *Ossuary 6 – Air* | Low bed looping under the interface |
| `work.mp3` | *Mechanolith* | Rises while a tool is running |

## Nota do A.P.O.L.O. (02/11/2026)

A tabela acima estava errada para `boot-music.mp3`: o arquivo herdado do fork
não era *Impact Prelude*, e sim a fala "Allow me to introduce myself. I am
JARVIS…" do filme *Homem de Ferro* (provável conteúdo protegido da
Marvel/Disney). Foi removido em 02/11/2026. A apresentação agora é falada pela voz do sistema
(`INTRO` em `src/App.tsx`); a intro musical personalizada é o RF-55.

A origem de `ambient.mp3` também não está confirmada: o histórico do fork diz
que foi uma "gravação fornecida" que substituiu a original. Verificar antes de
qualquer uso público.

## Attribution to paste into a video description

```
Music by Kevin MacLeod (incompetech.com)
  "Impact Prelude"    — Licensed under Creative Commons: By Attribution 4.0
  "Ossuary 6 - Air"   — Licensed under Creative Commons: By Attribution 4.0
  "Mechanolith"       — Licensed under Creative Commons: By Attribution 4.0
http://creativecommons.org/licenses/by/4.0/
```

## Why not the actual Iron Man score

Disney/Marvel run one of the most aggressive Content ID operations on YouTube.
Real film score or JARVIS dialogue in an upload means a near-certain claim,
demonetisation, or a strike — on a video whose whole point is to be seen. These
tracks are in the same register and cost you a line of text instead.

## Replacing them

Drop in any MP3 with the same filename and it takes over — nothing in the code
references the track names. Other sources worth a look: incompetech.com (same
licence), Pixabay Music (CC0, no attribution at all), and the YouTube Audio
Library.

The short interface sounds — wake pips, tool ticks, the completion chime — are
not files. They're synthesised in Web Audio in `src/lib/sfx.ts`, so there's
nothing to download and nothing to credit. Drop `wake.mp3`, `listen.mp3`,
`tool.mp3`, `done.mp3` or `error.mp3` in here to override any of them.

# Componentes de terceiros

Todos vêm incluídos no repositório (nada é baixado de CDN em tempo de execução).

| Componente | Versão | Licença | Local |
|---|---|---|---|
| React | 18.3.1 | MIT — © Meta Platforms, Inc. | `vendor/react.production.min.js` |
| React DOM | 18.3.1 | MIT — © Meta Platforms, Inc. | `vendor/react-dom.production.min.js` |
| Syne (fonte) | pacote `@fontsource/syne` | SIL Open Font License 1.1 — © Bonjour Monde | `fonts/syne-*.woff2` |
| JetBrains Mono (fonte) | pacote `@fontsource/jetbrains-mono` | SIL Open Font License 1.1 — © JetBrains | `fonts/jetbrains-mono-*.woff2` |

O Google Identity Services (`accounts.google.com/gsi/client`) só é carregado quando o usuário toca em "Conectar" no backup do Drive.

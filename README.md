# Finance Real

Controle de finanças pessoais que roda no navegador, **funciona offline** e guarda tudo **só no seu aparelho**. Instalável como app (PWA) no celular e no computador. Sem servidor, sem conta, sem etapa de build.

- Lançamentos de receita, despesa e transferência entre contas, com edição.
- Recorrências (mensal, semanal, anual) e parcelamentos (1 lançamento por parcela, valores que fecham ao centavo).
- Projeção de meses futuros: receitas e despesas previstas, patrimônio projetado e meta de poupança.
- Várias contas, categorias personalizadas, histórico mensal, alertas de vencimento.
- Português, inglês e espanhol; 13 moedas.
- PIN de acesso (hash PBKDF2) e biometria local (WebAuthn).
- Backup em arquivo JSON e, opcionalmente, no Google Drive (pasta oculta do app).

## Rodar localmente

```bash
npm run serve        # http://localhost:8080
npm test             # testes unitários (Node 20+, sem dependências)
npm run check        # verificações estáticas
npm run build:single # gera dist/FinanceReal.html (arquivo único, abre direto do disco)
```

Não há `npm install`: o projeto não tem dependências. React e as fontes já estão em `vendor/` e `fonts/`.

> Para o arquivo único (`dist/FinanceReal.html`) o instalador de app e o modo offline por service worker não funcionam, porque exigem `http(s)`. Os dados continuam sendo guardados normalmente.

## Publicar no GitHub Pages

1. Crie um repositório e envie o conteúdo desta pasta para a branch `main`.
2. Em **Settings → Pages → Build and deployment**, escolha **Source: GitHub Actions**.
3. O workflow `.github/workflows/pages.yml` roda os testes e publica em `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

Os caminhos são relativos, então funcionam em subpasta sem ajuste.

**Ao lançar uma versão nova**, aumente `version` em `package.json` **e** `VERSION` em `sw.js` (o `npm run check` avisa se estiverem diferentes). É isso que faz o app instalado baixar a atualização.

## Configuração (`config.js`)

Nada neste arquivo é segredo; ele é público. Veja `config.example.js`.

| Campo | Para quê |
|---|---|
| `googleClientId` | Liga o backup no Google Drive. Vazio = recurso desligado. |
| `donate.enabled` | `false` esconde a tela "Apoie o Finance Real". |
| `donate.pixKey`, `receiverName`, `receiverCity` | Ativa o Pix da contribuição única. Vazio = botão desativado (aparece como prévia). |
| `donate.usdToBrl` | Cotação de referência (reais por US$ 1) para converter o valor em dólar para o Pix. O app não consulta cotação (funciona offline), então atualize de vez em quando. |
| `donate.recurringUrl` | Links `https` de checkout para mensal e anual numa plataforma de cobrança recorrente. Vazio = botão desativado. |

### Apoio voluntário

Em **Configurações → Apoie o Finance Real**: contribuição única (US$ 1, 3, 5, 10 ou outro valor; padrão US$ 3), apoiador mensal (US$ 1) e anual (US$ 10, cerca de 17% abaixo de 12 mensalidades). Nada é bloqueado e o pagamento é independente do app: ele não lê saldos nem lançamentos. O Pix é gerado em reais pela cotação de `usdToBrl`; mensal e anual abrem o checkout da sua plataforma. Se for publicar nas lojas de aplicativos, confira as regras de cada loja para contribuições.

### Backup no Google Drive

1. No [Google Cloud Console](https://console.cloud.google.com/) crie um projeto e ative a **Google Drive API**.
2. Em **APIs e serviços → Tela de permissão OAuth**, configure o app (externo) e adicione o escopo `.../auth/drive.appdata`.
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**, adicione em *Origens JavaScript autorizadas* o endereço do seu Pages (ex.: `https://SEU_USUARIO.github.io`).
4. Copie o ID do cliente para `googleClientId` em `config.js`.

O app só pede o escopo `drive.appdata`: ele enxerga apenas a própria pasta oculta, nunca os seus arquivos. O token fica só na sessão do navegador (some ao fechar a aba) e o envio automático só acontece enquanto houver sessão ativa; se expirar, o app avisa e você reconecta com um toque.

## Segurança e privacidade

- Os dados ficam no `localStorage` do navegador. **Nada é enviado a servidores**, exceto o backup no Drive, se você ligar.
- O **PIN só bloqueia a tela**: ele não criptografa os dados guardados. Quem tiver acesso ao aparelho desbloqueado e ao DevTools consegue ler o `localStorage`. Use o bloqueio de tela do sistema e faça backups.
- O PIN é guardado com PBKDF2 (salt aleatório) e há bloqueio temporário após erros repetidos.
- A biometria usa WebAuthn **localmente como trava de tela** (não há servidor para validar a assinatura).
- `Content-Security-Policy` restritiva no `index.html`; backups importados são validados e higienizados campo a campo antes de serem aplicados, e uma cópia do estado anterior é guardada.
- Dados que não passam na validação ao abrir o app vão para uma chave de quarentena em vez de serem apagados.

## Estrutura

```
index.html  manifest.webmanifest  sw.js  config.js
js/core.js   regras puras: datas, saldos, recorrência, projeção, validação, PIN, PIX (testado)
js/i18n.js   textos pt/en/es, moedas, categorias, dicas
js/drive.js  API do Google Drive (appDataFolder)
js/app.js    interface React
css/ fonts/ vendor/ icons/
tests/       node:test
scripts/     serve, check, build-single
```

## Adicionar um idioma

1. Em `js/i18n.js`, copie o bloco `pt` para o novo código (ex.: `fr`) e traduza. O teste `tests/i18n.test.js` confere se todas as chaves e `{placeholders}` existem.
2. Adicione o código em `LOCALES` (`js/app.js`), com o locale do navegador (ex.: `fr: "fr-FR"`). O seletor da aba Usuário é montado automaticamente a partir de `js/i18n.js`.

## Licença

MIT (veja `LICENSE`). Componentes de terceiros em `THIRD_PARTY.md`.

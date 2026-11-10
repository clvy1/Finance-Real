# Auditoria do arquivo original e o que mudou

Arquivo de partida: `FinanceReal_restaurado.html` (1937 linhas, React por CDN, tudo num só arquivo).

## Defeitos corrigidos

| # | Problema no original | Correção |
|---|---|---|
| 1 | **Tela em branco ao abrir**: `currentYM` era usado antes de ser declarado (erro de inicialização do React). | Lógica de projeção movida para `core.js`; `currentYM` definido antes do uso. |
| 2 | Dados pessoais fixos no código (e-mail, chave PIX, lançamentos de exemplo). | Removidos. PIX e Drive vêm de `config.js`; começa com uma conta "Carteira" vazia. |
| 3 | Não dava para **editar** lançamento. | Edição completa (valor, descrição, categoria, data, status, conta). |
| 4 | Recorrente pago não gerava a próxima ocorrência; recorrências duplicavam na projeção. | Ao pagar, cria a próxima; projeção deduplica por série. |
| 5 | Parcelas: soma podia diferir do total e só dava para apagar uma a uma. | Divisão ao centavo; exclusão "só esta / esta e as seguintes / todas". |
| 6 | Card "A PAGAR" somava pendências de **todos** os meses. | Mostra só o mês selecionado. |
| 7 | Restaurar backup aceitava qualquer JSON. | Validação e higienização campo a campo; cópia do estado anterior antes de aplicar. |
| 8 | PIN de 4 dígitos em texto puro; sem limite de tentativas. | PBKDF2 com salt, bloqueio temporário; a dica na tela deixa claro que o PIN não criptografa os dados. |
| 9 | Biometria era só um interruptor sem efeito. | Trava local real via WebAuthn (ou desligada se não houver suporte). |
| 10 | Backup no Drive: token em `localStorage`, escopo amplo, botões sem função. | Escopo `drive.appdata`, token só na sessão, enviar/listar/restaurar funcionando. |
| 11 | `localStorage` corrompido derrubava o app. | Validação ao ler; dado inválido vai para quarentena; `ErrorBoundary` com exportação dos dados brutos. |
| 12 | Textos fixos em português fora do i18n; fr/de/it/zh incompletos. | ~110 textos movidos para o i18n; ficam pt/en/es completos (342 chaves cada, conferidas por teste). |
| 13 | Zoom bloqueado, modais sem foco/Esc/rótulos, contraste baixo, FAB fora da tela em 320px. | Acessibilidade básica (roles, `aria-*`, foco, Esc), 16px nos campos, contraste ajustado. |
| 14 | Dependia de CDN (React, fontes) e do Google na abertura; sem service worker real. | Tudo local; manifest e service worker de verdade; funciona offline. |

## Apoio voluntário (v5.1.0)

Nova tela em Configurações → Apoie o Finance Real, no lugar do cartão da aba Usuário (que cobrava US$ 20 pelo café e tinha selo de "apoiador"):

| Modalidade | Valor | Observação |
|---|---|---|
| Pague um café (única) | US$ 3 (atalhos 1, 3, 5, 10 e "outro") | Pix em reais pela cotação `usdToBrl` do `config.js` (≈ R$ 15 a R$ 5,05) |
| Apoiador (mensal) | US$ 1 / mês | abre o checkout de `recurringUrl.monthly` |
| Apoiador anual | US$ 10 / ano | US$ 0,83/mês, ~17% abaixo de 12 mensalidades; `recurringUrl.yearly` |

Sem canal configurado o botão fica desativado, com aviso de prévia. Nada é bloqueado e o pagamento não acessa dados do app. Corrigido também um descompasso: o `config.js` usava `pixName`/`pixCity`, mas o código lê `receiverName`/`receiverCity`.

## Mudanças de comportamento a conhecer

- Lançamento recorrente: ao marcar como pago, a próxima ocorrência nasce pendente.
- No patrimônio projetado entram também as pendências em aberto do mês (aparecem em "em aberto").
- Idiomas fr, de, it e zh foram removidos (as traduções estavam incompletas); a estrutura permite voltar a adicioná-los.
- Os dados antigos (`fr4_*`) são lidos normalmente; dados da versão simplificada (`fr6_*`) são migrados sem apagar o original.

## O que foi testado

- 31 testes unitários (`npm test`): datas, saldos, recorrência/projeção, parcelas, validação, PIN, PIX (CRC16), backup, i18n, e o módulo do Drive com `fetch` simulado.
- Testes de navegador (Chrome headless): criar/editar/excluir, parcelas, recorrência, transferência, projeção, backup e restauração (inclusive arquivo inválido), PIN, idioma, dados corrompidos, offline, tela de 320px e o arquivo único via `file://`.
- **Não testado contra serviços reais**: login Google/Drive (só com `fetch` simulado) e biometria WebAuthn em aparelho físico.

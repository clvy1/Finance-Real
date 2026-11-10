/* Configuração pública do Finance Real. Nada aqui é segredo: tudo vai para o navegador.
 *
 * googleClientId  ID de cliente OAuth (tipo "Aplicativo da Web") para o backup no Google Drive.
 *                 Vazio = o recurso fica desativado. Veja o README.
 * donate          Tela "Apoie o Finance Real" (Configurações). Apoio é voluntário; nada é bloqueado.
 *   enabled        false esconde a tela por completo.
 *   pixKey         Chave PIX para a contribuição única. Vazio = botão desativado (aparece como prévia).
 *   receiverName   Nome do recebedor no PIX (até 25 caracteres, sem acento).
 *   receiverCity   Cidade do recebedor no PIX (até 15 caracteres, sem acento).
 *   usdToBrl       Cotação de referência usada para converter o valor em dólar para o PIX (em reais).
 *                  Atualize de tempos em tempos: o app funciona offline e não consulta cotação.
 *   recurringUrl   Links de checkout (https) da plataforma de cobrança recorrente: { monthly, yearly }.
 *                  Vazio = botão desativado (prévia). A plataforma deve mostrar valor, data de cobrança e cancelamento.
 */
window.FR_CONFIG = {
  googleClientId: "",
  donate: {
    enabled: true,
    pixKey: "clvy@hotmail.com",
    receiverName: "Celso Ferreira",
    receiverCity: "Rio de Janeiro",
    usdToBrl: 5.05,
    recurringUrl: { monthly: "", yearly: "" }
  }
};

# Troco devolvido por Pix sem erro no caixa

## O que aconteceu

A tela de comanda **já tem** o caminho certo para esse caso, mas ele é fácil de usar errado:

- No campo **"Valor pago"** (forma de pagamento Dinheiro) deve ir o valor da venda: **R$ 166,50** — é o que entra no caixa.
- No campo **"Quanto o cliente entregou em dinheiro?"** vai o que o cliente entregou: **R$ 200,00**.
- A tela então mostra **"Troco a devolver: R$ 33,50"** e pergunta **"Como o troco foi devolvido?"** — basta escolher **Pix**.
- O sistema registra o troco como saída via Pix (não sai da gaveta) e o caixa fecha certinho.

No print, a atendente digitou 200 no "Valor pago", então a tela acusou "sobram R$ 33,50" e bloqueou o salvamento.

## Melhoria para evitar o erro

Como a confusão é recorrente, vou deixar a tela à prova de erro:

1. **Preenchimento automático:** quando a atendente digitar "quanto o cliente entregou" e houver troco, o campo "Valor pago" em dinheiro é ajustado automaticamente para o valor da comanda (o que entra no caixa). Ela ainda pode corrigir manualmente se precisar.
2. **Resumo em destaque:** quando houver troco, mostrar um quadro claro: "Cliente entregou R$ 200,00 · Entra no caixa R$ 166,50 · Troco R$ 33,50 via Pix".
3. **Aviso mais claro:** trocar o texto de atenção por uma instrução direta: "Pagou com nota maior? Digite o valor da venda em 'Valor pago' e o que o cliente entregou no campo abaixo."

## Detalhes técnicos

- Apenas `src/components/transaction-dialog.tsx`: efeito que sincroniza o valor do pagamento em dinheiro com o total da comanda quando `cashReceived` gera troco; novo bloco de resumo; texto do aviso.
- Nenhuma mudança no banco ou nos cálculos — a regra de troco via Pix (`computeRunningCash` soma a sobra em espécie) já está correta e testada.

## Resultado esperado

Venda de R$ 166,50 paga com R$ 200 em dinheiro e troco de R$ 33,50 no Pix: a atendente digita 200 em "entregou", escolhe Pix, e o caixa fecha sem divergência.

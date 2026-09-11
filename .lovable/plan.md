# Corrigir o fechamento do caixa da Mayna

## Diagnóstico confirmado

- O turno da Mayna na unidade Coronel Texeira está aberto com R$ 915,25.
- Há R$ 45,00 de entrada em dinheiro e R$ 5,00 de troco em dinheiro.
- Como a venda já foi registrada pelo valor líquido de R$ 45,00, o troco não deve ser descontado novamente.
- O valor esperado correto para o fechamento é R$ 960,25.
- Nenhuma contagem de fechamento foi gravada; o bloqueio acontece na conferência anterior ao fechamento.

## Implementação

1. Centralizar a conferência do fechamento na mesma regra financeira autoritativa usada pelo banco, eliminando cálculos duplicados que possam tratar o troco de forma diferente.
2. Garantir que troco em dinheiro não altere novamente o saldo e que troco via Pix acrescente a sobra em espécie.
3. Manter a contagem cega: retornar somente se confere ou não, sem revelar o valor esperado à colaboradora.
4. Preservar o fluxo de recontagem e a possibilidade de confirmar uma divergência real com justificativa.
5. Adicionar um teste de regressão reproduzindo este turno: R$ 915,25 + venda líquida de R$ 45,00 + troco de R$ 5,00 em dinheiro = R$ 960,25.
6. Validar o fechamento completo e a visualização em celular antes de concluir.

## Resultado esperado

Ao contar R$ 960,25, a Mayna poderá fechar o caixa sem receber um alerta falso de divergência.

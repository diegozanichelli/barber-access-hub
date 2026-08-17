# Auditoria de fluxo de dados e cálculos

Revisei o cálculo de caixa (`src/lib/running-cash.ts`), o painel de turno (`src/components/shift-panel.tsx`), o histórico (`src/components/shift-history.tsx`), o painel do sócio e o feed do auditor. Encontrei 6 problemas reais de cálculo/fluxo. Abaixo o que está errado e a correção proposta.

## 1. O caixa em gaveta parte do valor errado (crítico)

`computeRunningCash` começa por `expected_opening_total` (o que *deveria* ter na gaveta), não por `actual_opening_total` (o que foi realmente contado). Se a abertura teve sobra ou falta, o "Dinheiro em caixa agora" e o alerta de R$ 1.000 ficam errados desde o primeiro minuto do turno.

Correção: usar o total contado na abertura como base do dinheiro físico, mantendo o esperado apenas para o cálculo de divergência.

## 2. Retirada contestada volta dinheiro para a gaveta

Hoje uma retirada `disputed` é ignorada no cálculo (o dinheiro "volta" ao saldo). Na prática o dinheiro saiu da gaveta — quem contesta é o sócio dizendo que não recebeu, o que é justamente uma divergência a investigar, não uma reversão automática.

Correção: descontar retiradas `pending` e `approved` **e** `disputed` do caixa físico, e sinalizar a contestada como divergência (já existe o alerta no painel do auditor).

## 3. Repasse apaga a divergência do turno que entra

No recebimento de turno, o novo turno é criado com `expected_opening_total = contagem do B`. Como esperado e contado ficam iguais, a linha do turno do B no histórico sempre mostra diferença zero, mesmo quando houve divergência no repasse.

Correção: o novo turno deve nascer com `expected_opening_total = closing_total do turno repassado` e `actual_opening_total = contagem do B`. A divergência passa a aparecer no histórico com valor.

## 4. Nenhuma conferência no fechamento (sobra/falta do turno)

Ao fechar, o sistema grava `closing_total` sem comparar com o caixa calculado (abertura + entradas em dinheiro − despesas − retiradas). Ou seja: um desvio durante o turno só é detectado no repasse — e se o próximo atendente contar o mesmo valor, nunca é detectado.

Correção: no fechamento, comparar contagem × caixa esperado, mostrar sobra/falta no resultado e registrar essa diferença para o auditor.

## 5. Histórico só mostra divergência de abertura

A coluna "Diferença" usa apenas abertura esperada × contada. Não existe coluna de divergência de fechamento (item 4), então o auditor não enxerga o desvio ocorrido dentro do turno.

Correção: adicionar colunas "Esperado no fechamento", "Repassado" e "Diferença do turno", com o mesmo destaque em vermelho.

## 6. Detalhes menores de fluxo de dados

- Valor da retirada: `Number("1.234,56".replace(",", "."))` vira `NaN`/valor errado quando o atendente digita separador de milhar. Normalizar a entrada.
- Ao abrir caixa, o "esperado" busca o último turno com `closing_total` preenchido — isso inclui turnos `pending_handover` e `disputed`. Restringir a turnos efetivamente encerrados.
- Confirmar/contestar retirada no painel do sócio não invalida as consultas do turno; o atendente só vê a mudança após 30s/recarga. Invalidar as chaves relacionadas.

## Detalhes técnicos

- `src/lib/running-cash.ts`: nova assinatura baseada no total contado + função auxiliar `computeExpectedClosing` reutilizada no fechamento.
- `src/components/shift-panel.tsx`: base do cálculo, criação do turno no repasse, diff de fechamento e normalização de valores.
- `src/components/shift-history.tsx`: colunas adicionais de divergência.
- `src/components/auditor-overview.tsx`: passa a usar a mesma base corrigida.
- `src/components/withdrawal-dialog.tsx` e `src/routes/_authenticated/socio.tsx`: parsing de valor e invalidação de cache.
- Sem mudança de schema: a divergência de fechamento é derivada de dados já gravados (`closing_total`, transações e retiradas).

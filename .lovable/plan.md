# Lançamentos agrupados por turno

## Objetivo

Na aba **Lançamentos** do painel do Auditor (`src/components/audit-feed.tsx`), trocar a lista única e plana de lançamentos por uma visão **agrupada por turno de caixa**, para facilitar identificar erros: cada turno vira um bloco com cabeçalho e seus lançamentos dentro, e **turnos abertos aparecem destacados no topo**.

## O que muda

### Visão por turno (nova, padrão)

- Consulta os turnos (respeitando o filtro de unidade), ordenados: **turnos abertos primeiro**, depois os demais do mais recente ao mais antigo.
- Cada turno vira um bloco com cabeçalho mostrando:
  - Unidade, data/hora de abertura e quem abriu.
  - Situação: "Turno aberto" (destaque visual, ex. selo em cor primária), "Fechado", "Com divergência".
  - Resumo do turno: total de entradas, total de saídas e saldo do período (calculados dos lançamentos do turno).
- Dentro de cada bloco, a lista de lançamentos daquele turno no formato atual (miniatura do comprovante, categoria, valor, selos de estorno/sangria, botões de estornar/excluir).
- Paginação passa a ser **por turno** (ex.: 10 turnos por página) em vez de por lançamento.

### Filtros existentes continuam valendo

- Unidade, tipo (entrada/saída), categoria e modalidade de pagamento filtram os lançamentos dentro de cada turno.
- Turnos que ficarem sem nenhum lançamento visível por causa do filtro mostram "Nenhum lançamento neste turno" (ou são ocultados — ver pergunta abaixo).

### Alternância de visão

- Um seletor no topo da aba: **"Por turno"** (novo padrão) e **"Lista simples"** (visão atual, preservada intacta).

### Sem mudanças

- Export CSV, estorno, exclusão, correção/exclusão de abertura e a seção "Aberturas de caixa ativas" continuam como estão.
- Nenhuma mudança de banco de dados — `transactions.shift_id` já existe.

## Detalhes técnicos

- Tudo em `src/components/audit-feed.tsx`:
  - Nova query paginada de `shifts` (filtro por unidade; ordenação: `status = 'open'` primeiro, depois `opened_at` desc).
  - Query de `transactions` com `.in("shift_id", idsDaPagina)` + filtros de tipo/categoria/modalidade, agrupadas em memória por turno.
  - Novo estado `viewMode: "shift" | "list"`; a renderização atual fica intacta no modo "list".
- Paginação por turnos usa `count` exato da tabela `shifts`.
- Verificação: typecheck/build e `bun test`.

## Pergunta resolvida na implementação

- Turno sem lançamentos visíveis após filtros: ocultar o bloco (mantém a tela limpa); turnos abertos sempre aparecem, mesmo vazios, pois o objetivo é encontrar erros.

# Melhorias no sistema — próxima etapa

O sistema está estável (build OK, sem erros no console) e a maior parte dos itens críticos da auditoria anterior já foi implementada: RPCs atômicas de fechamento/repasse, cofre acumulado por unidade, estorno com trilha, correção de divergências, nota de R$ 200, parsing de valores e recontagem forçada. O que resta melhorar, em ordem de prioridade:

## 1. Desempenho do painel do Auditor (maior impacto)

Hoje `use-auditor-data.ts` baixa **todos** os turnos, lançamentos, contagens e retiradas de toda a história a cada 30 segundos. Conforme o volume cresce, o painel fica lento e caro.

- Filtro de período no topo do painel (padrão: últimos 30 dias; opções: 7 / 30 / 90 dias / tudo).
- Período aplicado nas consultas e no CSV exportado.

## 2. Confirmações e estados de erro na operação (segurança financeira)

- "Fechar Caixa" já tem confirmação de dois toques; estender o mesmo padrão (diálogo com resumo do valor) para **Registrar retirada de sócio**, **Confirmar repasse** e **Contestar**.
- Falhas de rede hoje podem aparecer como "nenhum caixa aberto": tratar carregamento/erro explicitamente no painel do turno, com mensagem e botão "Tentar de novo", e nunca oferecer "Abrir Caixa" sem leitura confirmada do turno.

## 3. Mobile (a operação é feita no celular)

- A tabela de histórico de turnos do Auditor vira cartões empilhados em telas pequenas.
- Revisão de áreas de toque e rolagem horizontal nos formulários de contagem e feed de auditoria.

## 4. Retirada de sócio mais rastreável

- Campo de observação opcional no registro da retirada.
- Foto opcional do comprovante de entrega (reuso do upload de comprovantes, bucket privado).

## 5. Alertas proativos

- Quando uma retirada é contestada ou um turno entra em divergência, notificar o Auditor (banner no painel já existe; adicionar push opcional via infra de `shift-reminders`).

## Detalhes técnicos

- `src/hooks/use-auditor-data.ts`: parâmetro `days` com `.gte("created_at", ...)` em shifts, transactions, cash_counts e partner_withdrawals; seletor de período na rota `/auditor`.
- `src/components/shift-panel.tsx` e `withdrawal-dialog.tsx`: diálogos de confirmação com resumo; estados `isError`/`isLoading` com retry.
- `src/components/shift-history.tsx`: layout de cartões abaixo de `md`.
- `partner_withdrawals`: nova coluna `notes` (text, opcional) + foto em `receipts` (GRANT/RLS seguem o padrão existente).

## Sugestão de execução

Itens 1 e 2 primeiro (desempenho e dinheiro), depois 3 e 4, e o 5 por último.

# Recontagem obrigatória quando há divergência

Hoje, quando o atendente ou supervisor fecha o caixa (ou recebe um repasse) com valor diferente do esperado, o sistema aceita na hora e só mostra um aviso rápido que some. A divergência aparece para o auditor, mas quem contou o dinheiro não tem chance de recontar. Muitas dessas diferenças são erro simples de contagem.

## Como vai funcionar

Antes de gravar qualquer contagem (abertura, fechamento e recebimento de repasse), o sistema confere em silêncio se o valor bate com o esperado.

- **Se bate:** grava normalmente, como hoje.
- **Se não bate:** nada é gravado ainda. Aparece uma tela de alerta em vermelho:
  - "A contagem não confere com o esperado. Reconte o dinheiro com calma."
  - **Nenhum valor é revelado** — sem esperado, sem diferença. A contagem continua cega, para ninguém "ajustar" os números.
  - Dois botões: **Recontar** (volta à calculadora com os campos zerados) e **Confirmar mesmo assim**.
- **Recontar** pode ser feito quantas vezes o usuário quiser. Se em alguma tentativa o valor bater, segue normal.
- **Confirmar mesmo assim** exige uma justificativa escrita (mínimo de caracteres, campo obrigatório). Só então a contagem é gravada, o turno segue o fluxo atual (repasse / divergência) e o auditor é notificado.

## O que o auditor passa a ver

Na tela de divergências do painel do auditor, além dos valores já mostrados hoje, aparece:

- a **justificativa** escrita pelo operador;
- **quantas vezes ele recontou** antes de confirmar.

Isso separa "errou a conta uma vez" de "insistiu numa diferença real".

## Detalhes técnicos

- Nova server function `checkCountDivergence` (autenticada) que recebe o tipo de operação (`opening` / `closing` / `handover`), o turno e as quantidades, calcula o total no servidor e retorna **apenas** `{ matches: boolean }` — nunca o valor esperado. Fontes do esperado: `shift_expected_cash(_shift_id)` para fechamento, `closing_total` do turno pendente para recebimento, e `closing_total` do último turno fechado da unidade para abertura.
- `src/components/shift-panel.tsx`: as mutations de abrir/fechar/receber passam a chamar essa checagem antes de `open_shift` / `close_shift` / `receive_handover`. Novo estado local de fluxo (`counting` → `divergence` → `justify`) com contador de recontagens.
- Novo componente `src/components/divergence-recount-dialog.tsx` com o alerta, os botões Recontar / Confirmar mesmo assim e o campo de justificativa.
- A justificativa e o número de recontagens vão no campo `notes` já existente da contagem (`cash_counts`), em formato padronizado — **sem migração de banco**.
- `src/components/auditor-overview.tsx` e o histórico de turnos exibem essa observação junto da divergência.
- Toasts pós-gravação para o operador continuam sem revelar valores esperados; apenas confirmam que a divergência foi registrada e enviada à auditoria.

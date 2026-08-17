# Gestão de Unidades no Painel do Auditor

Hoje as unidades (Parque 10, Ponta Negra) só existem porque foram criadas direto no banco. O Auditor não tem tela para criar, renomear ou remover unidades. O banco já permite que o Auditor faça isso — falta apenas a interface.

## O que será construído

Uma nova aba **"Unidades"** no painel do Auditor, ao lado de Visão geral, Lançamentos, Turnos e Usuários:

- Lista de todas as unidades, em ordem alfabética, com a quantidade de usuários vinculados a cada uma.
- Campo "Nome da unidade" + botão **Criar unidade**.
- Em cada unidade: botão **Renomear** (edição no próprio item) e **Excluir**.
- Exclusão pede confirmação e é bloqueada quando a unidade já tem usuários, turnos, lançamentos ou retiradas ligados a ela — nesse caso a mensagem explica o motivo em vez de dar erro técnico.
- Nomes duplicados são recusados com aviso claro.
- Após qualquer alteração, os seletores de unidade da aba Usuários e a Visão geral atualizam automaticamente.

## Detalhes técnicos

- Novo componente `src/components/unit-manager.tsx` com a lista, formulário de criação e ações de renomear/excluir, usando TanStack Query (`["units"]`) e os componentes de UI existentes (Input, Button, AlertDialog, toast/sonner).
- Leituras e escritas via cliente Supabase do navegador na tabela `units`; a política `units_admin_manage` já autoriza o Auditor a inserir, atualizar e excluir.
- Antes de excluir, contar registros dependentes em `profiles`, `shifts`, `transactions` e `partner_withdrawals` para exibir bloqueio amigável.
- `src/routes/_authenticated/auditor.tsx`: acrescentar a aba "Unidades" (grid de 5 colunas na TabsList) renderizando o novo componente, e invalidar `["units"]` e `["auditor-data"]` após as mutações.
- Nenhuma mudança de banco de dados é necessária.

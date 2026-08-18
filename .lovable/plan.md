# Cadastro com aprovação + edição de usuários pelo Auditor

## O que muda para o usuário

**1. Tela de cadastro (Criar conta)**
- Passa a ter um campo "Função desejada": Atendente, Supervisor ou Sócio (Auditor/Admin não fica disponível no cadastro público).
- Ao criar a conta, a pessoa NÃO entra no painel. Vê uma tela "Cadastro enviado — aguardando aprovação do administrador", com botão de sair.
- Enquanto não for aprovada, qualquer tentativa de login cai nessa mesma tela de espera. Se for recusada, vê "Cadastro não aprovado".

**2. Nova aba "Aprovações" no painel do Auditor**
- Lista os cadastros pendentes: nome, e-mail, função desejada, unidade escolhida e data.
- O Auditor pode ajustar a função e a unidade antes de aprovar.
- Botões "Aprovar" e "Recusar". Ao aprovar, o usuário passa a acessar o painel da função definida.
- Contador de pendentes visível na aba.

**3. Edição de usuários (somente Auditor)**
- Na aba "Usuários", cada pessoa ganha campos editáveis de **nome** e **e-mail**, além de função e unidade.
- Botão "Redefinir senha" que permite ao Auditor definir uma nova senha diretamente (com confirmação e mínimo de 6 caracteres).
- O Auditor continua sem poder rebaixar a si mesmo.

## Detalhes técnicos

**Banco (migração)**
- Novo enum `approval_status` (`pending`, `approved`, `rejected`).
- `profiles`: colunas `status approval_status not null default 'pending'`, `requested_role app_role`, `approved_by uuid`, `approved_at timestamptz`.
- Usuários existentes recebem `status = 'approved'` (backfill), para ninguém perder acesso.
- `handle_new_user()` atualizado: grava `requested_role` vindo do metadata, cria o perfil com `status = 'pending'` e **não** insere mais em `user_roles` (o papel só é atribuído na aprovação).
- Função `public.is_approved(_user_id uuid)` (security definer) para checagens.
- Grants: `select/update` de `profiles` para `authenticated` mantidos; leitura de pendentes é feita via server function admin.

**Frontend**
- `src/routes/auth.tsx`: select de função desejada no cadastro; após signup, redireciona para `/pendente` (ou mostra estado de espera).
- Nova rota pública `src/routes/pendente.tsx` com estado aguardando/recusado e botão sair.
- `src/routes/index.tsx` e `src/routes/_authenticated/route.tsx`: checar `profiles.status`; se não for `approved`, redirecionar para `/pendente`.
- `src/lib/admin-users.functions.ts`: novas server functions (todas com verificação de auditor via `has_role`):
  - `listPendingUsers`, `approveUser({ userId, role, unitId })`, `rejectUser({ userId })`
  - `updateManagedUser` estendido com `fullName` e `email` (email via `supabaseAdmin.auth.admin.updateUserById`)
  - `resetUserPassword({ userId, password })`
- `src/routes/_authenticated/auditor.tsx`: nova aba "Aprovações" (6 abas) e campos de nome/e-mail/senha na aba "Usuários".

# Caixa Grupo Roots

Sistema web de operação e auditoria de caixa para redes de barbearias. O projeto é conectado ao [Lovable](https://lovable.dev/projects/d6f9a349-2b1d-4b19-8905-272d787e72b9) e usa Supabase para autenticação, PostgreSQL e armazenamento privado de comprovantes.

## Funcionalidades

- Cadastro com aprovação administrativa e acesso por papel.
- Painéis para **Atendente**, **Supervisor**, **Sócio** e **Auditor**.
- Gestão de unidades, usuários, papéis e vínculos com unidades.
- Abertura, fechamento e repasse de turnos com contagem cega por denominação.
- Entradas, despesas e sangrias, incluindo comprovantes privados quando exigidos.
- Saldo físico da gaveta, saldo acumulado do cofre e alerta de limite de caixa.
- Retiradas de sócios com confirmação ou contestação.
- Visão consolidada, divergências, histórico, feed de auditoria e exportação CSV.

## Papéis e rotas

| Papel           | Rota          | Acesso principal                                  |
| --------------- | ------------- | ------------------------------------------------- |
| Atendente       | `/atendente`  | Operação do caixa da unidade atribuída            |
| Supervisor      | `/supervisor` | Operação e acompanhamento do caixa da unidade     |
| Sócio           | `/socio`      | Confirmação e contestação das próprias retiradas  |
| Auditor / Admin | `/auditor`    | Auditoria da rede e gestão de usuários e unidades |

Novas contas de atendente, supervisor ou sócio ficam pendentes até a aprovação de um auditor. O papel de auditor não pode ser solicitado no cadastro público.

## Stack

- React 19, TypeScript e Vite
- TanStack Start, Router e Query
- Tailwind CSS e Radix UI
- Supabase Auth, PostgreSQL, Row Level Security e Storage
- Zod para validação

## Desenvolvimento local

### Pré-requisitos

- Node.js compatível com as dependências do projeto
- npm ou Bun
- Projeto Supabase com as migrations de `supabase/migrations` aplicadas

### Variáveis de ambiente

Crie um arquivo `.env` sem versionar segredos:

```sh
# Disponíveis no bundle do navegador
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel

# Usadas pelo servidor TanStack Start
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
```

A `SUPABASE_SERVICE_ROLE_KEY` é exclusiva do servidor e nunca deve receber o prefixo `VITE_`.

### Instalação e execução

```sh
npm install
npm run dev
```

A aplicação utiliza as seguintes verificações:

```sh
npm run lint
npm run test
npm run build
```

Com o Supabase CLI e Docker disponíveis, execute também os testes de integração das políticas
RLS e RPCs:

```sh
supabase start
supabase test db
```

## Estrutura principal

```text
src/routes/                    Rotas e painéis por papel
src/components/                Fluxos de caixa, auditoria e componentes visuais
src/hooks/                     Consultas compartilhadas da sessão e auditoria
src/lib/                       Regras de negócio, validação e server functions
src/integrations/supabase/     Clientes, middleware e tipos do Supabase
supabase/migrations/           Esquema, RPCs, triggers e políticas RLS
```

## Segurança

- As rotas privadas exigem uma sessão válida e cada painel valida o papel aprovado do usuário.
- As políticas de Row Level Security do Supabase são a barreira principal de acesso aos dados.
- Operações administrativas usam server functions autenticadas e um cliente de serviço apenas no servidor.
- Comprovantes ficam em bucket privado e são acessados por URLs assinadas temporárias.

## Sincronização com Lovable

Commits enviados à branch conectada aparecem no editor Lovable. Não reescreva o histórico já publicado com force push, rebase, amend ou squash.

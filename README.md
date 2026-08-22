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

O projeto usa dois arquivos, e a separação entre eles é uma barreira de segurança.

**`.env` — versionado.** O arquivo está rastreado pelo git, então só pode conter
valores públicos. A chave publishable já é entregue no bundle do navegador, logo
não há segredo a proteger aqui.

```sh
# Disponíveis no bundle do navegador
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel

# Usadas pelo servidor TanStack Start
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel
```

**`.env.local` — nunca versionado** (o `.gitignore` já o exclui via `*.local`).
É o único lugar para segredos de servidor:

```sh
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
```

A `SUPABASE_SERVICE_ROLE_KEY` **ignora todas as políticas de Row Level Security** —
ou seja, contorna a barreira de acesso descrita em [Segurança](#segurança). Ela é
exclusiva do servidor, nunca deve receber o prefixo `VITE_` (o que a publicaria no
bundle do navegador) e **nunca deve ser colocada no `.env`**, que é versionado: um
`git add -A` publicaria a chave no repositório. O Vite carrega `.env.local` com
prioridade sobre `.env`, então basta defini-la lá.

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

## Lembretes de fechamento de caixa

Quando ninguém fecha o caixa, o turno segue aberto e os lançamentos do dia
seguinte entram nele — a RLS aceita, porque o turno está `open`, e o índice
único impede abrir outro. Os dois dias se misturam sem nenhum aviso.

O sistema avisa em duas camadas:

1. **Banner na tela do turno.** Não depende de configuração nenhuma. Aparece
   para quem abrir o app com um caixa aberto além do limite.
2. **Notificação no celular.** Cobre quem já foi embora. Exige a configuração
   abaixo; sem ela, o recurso simplesmente não aparece e a camada 1 continua
   funcionando.

Os parâmetros ficam na tabela `app_settings` e podem ser mudados por SQL, sem
deploy: `shift_reminder_after_hours` (padrão 10), `shift_reminder_repeat_hours`
(padrão 4) e `shift_reminder_max_count` (padrão 3).

### Configurar as notificações

**1. Gere o par de chaves VAPID** (uma vez, e guarde a privada como segredo):

```sh
npx web-push generate-vapid-keys
```

**2. Publique a chave pública no bundle**, em `.env`:

```sh
VITE_VAPID_PUBLIC_KEY=sua-chave-publica
```

**3. Registre os segredos do servidor** — a chave privada **nunca** vai para o
`.env` versionado nem recebe o prefixo `VITE_`:

```sh
supabase secrets set VAPID_PUBLIC_KEY=sua-chave-publica
supabase secrets set VAPID_PRIVATE_KEY=sua-chave-privada
supabase secrets set VAPID_SUBJECT=mailto:seu-email@dominio.com
```

**4. Publique a função:**

```sh
supabase functions deploy shift-reminders
```

**5. Agende a execução** com `pg_cron` e `pg_net`, no SQL editor. A função só
aceita chamada autenticada com a service role, então ela não pode ser disparada
de fora:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'shift-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/shift-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    )
  );
  $$
);
```

Guarde a service role em `app.service_role_key` (via `ALTER DATABASE ... SET`)
em vez de escrevê-la dentro do agendamento, que fica legível para quem consultar
`cron.job`.

### Limitações que valem saber

- **No iPhone**, o push só existe se a pessoa adicionar o app à Tela de Início.
  Enquanto isso não acontece, o app explica isso na tela em vez de oferecer um
  botão que não funcionaria.
- **Se a pessoa negar a permissão** ou desinstalar, o envio falha e a inscrição
  morta é removida automaticamente no envio seguinte.
- **Notificação de navegador não é garantia de entrega.** Para lembrete que
  precisa chegar, WhatsApp ou SMS são canais mais confiáveis — ao custo de um
  provedor e do cadastro dos telefones.

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

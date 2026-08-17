# Corrigir acesso: conta criada entrou como Atendente

## O que está acontecendo

1. **Todo cadastro novo vira Atendente.** É a regra atual do sistema: quem se inscreve pela tela de "Criar conta" recebe o papel Atendente, e só um Auditor pode promover alguém a Supervisor, Sócio ou Auditor. Hoje sua conta (cassiano.diego@gmail.com) está como Atendente e sem unidade — por isso o painel mostra "Unidade não atribuída".

2. **Existe também uma falha de permissão no banco.** A função que verifica papéis (`has_role`) não tem permissão de execução para usuários logados. Confirmado nos registros: as leituras de perfil e de papéis retornam erro "permission denied for function has_role" (403). Ou seja, mesmo se o papel fosse Auditor, várias telas quebrariam.

## O que vou fazer

- **Migração no banco:**
  - Conceder permissão de execução da função de verificação de papéis para usuários autenticados (corrige os erros 403 em perfis, turnos, transações, retiradas).
  - Promover a conta cassiano.diego@gmail.com para **Auditor/Admin**, removendo o papel Atendente.

- **Regra de primeiro acesso (opcional, incluída):** manter o cadastro público criando Atendentes, já que o Auditor agora existe e pode promover os demais pela aba "Usuários".

Depois disso, ao entrar você será levado direto ao painel do Auditor, com a gestão de usuários funcionando.

## Detalhes técnicos

```sql
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
-- promoção do usuário para auditor em public.user_roles
```

Nenhuma mudança de código de aplicação é necessária; o roteamento por papel (`ROLE_ROUTES`) já direciona Auditor para `/auditor`.

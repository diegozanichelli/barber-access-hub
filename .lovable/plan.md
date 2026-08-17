# Sangria alimenta o cofre; retirada de sócio sai do cofre

Hoje a sangria e a retirada de sócio descontam o mesmo dinheiro da gaveta, então quando o sócio retira o valor que já tinha ido para o cofre a conta é descontada duas vezes. O fluxo correto: sangria tira da gaveta e coloca no cofre; retirada de sócio tira do cofre, nunca da gaveta.

## Regras acordadas

- Retirada de sócio sempre sai do cofre.
- Saldo do cofre é por turno: soma das sangrias do turno menos as retiradas do turno.
- Retirada acima do saldo do cofre fica bloqueada.

## O que muda

1. Cálculo de caixa (`src/lib/running-cash.ts`)
   - "Dinheiro em caixa agora" continua descontando sangrias (o dinheiro saiu da gaveta), mas deixa de descontar retiradas de sócio.
   - Nova função de saldo do cofre: sangrias do turno menos retiradas do turno (pendentes, confirmadas e contestadas — o dinheiro saiu do cofre).
   - Mesma mudança vale para o esperado de fechamento, que passa a não subtrair retiradas.

2. Turno ativo (`src/components/shift-panel.tsx`)
   - Nova linha "Disponível no cofre" ao lado de "Dinheiro em caixa agora".
   - Botão "Retirada de Sócio" desabilitado quando o cofre está zerado, com texto explicando que é preciso fazer uma sangria antes.

3. Diálogo de retirada (`src/components/withdrawal-dialog.tsx`)
   - Mostra o saldo disponível no cofre e bloqueia o botão quando o valor pedido excede esse saldo, com mensagem clara.
   - Texto atualizado: a retirada sai do cofre, não da gaveta.

4. Painel do Auditor (`src/components/auditor-overview.tsx`, `src/components/shift-history.tsx`)
   - Overview passa a mostrar, por unidade, o dinheiro em gaveta e o saldo do cofre separados.
   - Histórico mantém as colunas atuais; o esperado de fechamento passa a usar a nova regra (sem descontar retiradas).

## Detalhes técnicos

- Sem migração de banco: sangria já é `transactions.category = 'Sangria'` e retiradas ficam em `partner_withdrawals`, ambas ligadas ao `shift_id`.
- A validação de saldo é feita no cliente (o formulário já carrega sangrias e retiradas do turno aberto); um valor acima do saldo simplesmente não pode ser enviado.
- Turnos antigos passam a exibir totais recalculados pela nova regra, sem alterar dados gravados.

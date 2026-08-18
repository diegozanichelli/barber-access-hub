# Auditoria do sistema: falhas de cálculo, fluxo de dados e UX

Revisei o cálculo de caixa, o painel de turno, retiradas, o dashboard do Auditor e os formulários. Abaixo, o que está errado hoje e o que proponho corrigir, em ordem de risco financeiro.

## P1 — Risco financeiro real

1. **O cofre "zera" a cada turno.** O saldo do cofre é calculado apenas com as sangrias e retiradas do turno aberto. Se o turno fecha com dinheiro no cofre, o turno seguinte mostra R$ 0,00 e o botão "Retirada de Sócio" fica bloqueado, mesmo com dinheiro físico guardado.
   Correção: saldo do cofre passa a ser por unidade e acumulado (todas as sangrias da unidade menos todas as retiradas da unidade), não por turno. O painel mostra "cofre da unidade" e a validação da retirada usa esse saldo.

2. **Retirada acima do cofre só é bloqueada no navegador.** Duas telas abertas ao mesmo tempo conseguem gravar retiradas que somadas estouram o cofre, deixando saldo negativo.
   Correção: criar uma função no banco que valida o saldo do cofre e grava a retirada na mesma operação; a tela passa a chamá-la em vez de inserir direto.

3. **Fechamento e repasse não são atômicos.** Fechar caixa faz duas gravações separadas (contagem + turno) e o repasse faz cinco. Se uma falhar no meio, sobram contagens órfãs, turno duplicado ou divergência perdida — e o atendente pode reenviar, gerando dois turnos.
   Correção: mover fechamento e repasse para funções no banco que executam tudo em uma transação, com bloqueio de reenvio.

4. **Falhas de carregamento aparecem como "nenhum caixa aberto".** Erros das consultas são ignorados; se a rede cair, a tela diz que não há caixa aberto e o atendente pode tentar abrir um segundo turno.
   Correção: tratar estado de erro e carregamento explicitamente em todos os painéis, com mensagem e botão "tentar de novo", e nunca mostrar "Abrir Caixa" sem confirmação de leitura do turno.

5. **Divergências não têm encerramento.** Turnos em `disputed` e retiradas contestadas ficam nesse estado para sempre; o Auditor vê o alerta mas não tem como resolver, então a lista de alertas só cresce.
   Correção: ação do Auditor para resolver a divergência com justificativa obrigatória, registrando quem resolveu e quando.

6. **Sem caminho de correção de lançamento errado.** O atendente não consegue estornar um valor digitado errado, e o Auditor não tem botão de exclusão na interface.
   Correção: estorno registrado (lançamento de correção vinculado ao original) disponível para Supervisor/Auditor, preservando trilha de auditoria.

## P2 — Cálculo e consistência de dados

7. **Valores com ponto viram valor errado.** "1.50" é interpretado como 150,00 porque todo ponto é removido. Correção: interpretar ponto como decimal quando não houver vírgula, e mostrar o valor formatado abaixo do campo antes de salvar.

8. **Pagamento misto sem conferência.** Não há checagem de linhas repetidas, valores zerados ou soma total; o total do atendimento não é confirmado. Correção: validar cada linha, bloquear métodos duplicados e exigir confirmação do total.

9. **Contagem cega aceita zero sem aviso.** É possível abrir/fechar o caixa com todas as quantidades em branco. Correção: pedir confirmação explícita quando o total contado for R$ 0,00.

10. **Rótulo errado no detalhe de contagem.** No Auditor, contagens de repasse aparecem como "Fechamento". Correção: rotular abertura, fechamento e repasse corretamente.

11. **Dashboard do Auditor carrega tudo.** Todos os turnos, lançamentos, contagens e retiradas de toda a história são baixados a cada 30 segundos. Correção: filtro de período (padrão: últimos 30 dias) aplicado na consulta e no CSV.

## P3 — UX

12. Ações financeiras sem confirmação: "Fechar Caixa", "Contestar" e "Registrar retirada" executam no primeiro toque. Adicionar confirmação com resumo do valor.
13. Sócio vê apenas pendentes: adicionar histórico das próprias retiradas confirmadas/contestadas.
14. Retirada de sócio sem identificação: campo de observação e foto opcional do comprovante de entrega.
15. Tabela de histórico não é usável no celular: virar cartões em telas pequenas.
16. Mensagens de erro do banco aparecem cruas para o atendente: traduzir os casos comuns (turno já fechado, sem permissão, sem unidade).

## Detalhes técnicos

- Novas funções no banco (security definer, com validação de papel e unidade): `close_shift`, `receive_handover`, `create_partner_withdrawal`, `resolve_dispute`, `reverse_transaction`.
- `src/lib/running-cash.ts`: `computeSafeBalance` passa a receber lançamentos e retiradas da unidade inteira; nova função de saldo do cofre por unidade usada em painel, diálogo de retirada e visão do Auditor.
- `src/lib/transactions.ts`: `parseAmount` com tratamento de ponto decimal e validação por linha de pagamento.
- `src/hooks/use-auditor-data.ts`: parâmetro de período e filtros nas consultas.
- Sem alteração destrutiva de dados existentes; apenas novas colunas de resolução de divergência (`resolved_by`, `resolved_at`, `resolution_note`).

## Sugestão de execução

Fazer P1 primeiro (é onde o dinheiro pode ficar errado), depois P2 e P3.

# Restaurar a categoria "Produtos"

## Diagnóstico (confirmado)

- O enum `transaction_category` **no banco ao vivo** não contém `Produtos` — os valores atuais são: Bebida, Assinatura Nova, Renovação, Despesa, Sangria, Upgrade, Serviços.
- O `src/integrations/supabase/types.ts` é gerado a partir do banco, então ele também está sem `Produtos`.
- O app usa `Produtos` em 4 lugares: `src/lib/transactions.ts`, `src/lib/sales-report.ts`, `src/components/transaction-dialog.tsx` e `src/components/audit-feed.tsx`.
- Hoje a compilação até passa, mas **registrar uma venda de "Produtos" falha no banco** com erro de valor inválido no enum — o código de erro intencionalmente recusa em vez de disfarçar a categoria.

## Correção proposta

1. **Migration no banco**: `ALTER TYPE public.transaction_category ADD VALUE IF NOT EXISTS 'Produtos';`
   - Adiciona a categoria sem apagar nem renomear nada existente.
   - Após a aprovação, o `types.ts` é regenerado automaticamente com `Produtos` incluído.
2. **Verificação**: conferir que `types.ts` passou a listar `Produtos`, rodar os testes (`bun test`) e confirmar o build.

Nenhuma mudança de código no app é necessária — a interface já oferece e exibe "Produtos"; só falta o banco aceitar o valor.

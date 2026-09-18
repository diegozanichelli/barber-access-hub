import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReceiptUpload } from "@/components/receipt-upload";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { friendlyError } from "@/lib/errors";
import { getReceiptUrl, parseAmount } from "@/lib/transactions";
import {
  canDepositAmount,
  depositAuthorLabel,
  depositSchema,
  uploadDepositReceipt,
  type PartnerBalance,
} from "@/lib/partner-deposits";

function usePartnerBalances() {
  return useQuery<PartnerBalance[]>({
    queryKey: ["partner-balances"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("partner_cash_balances");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        partner_id: r.partner_id,
        full_name: r.full_name,
        held: Number(r.held ?? 0),
        waiting: Number(r.waiting ?? 0),
      }));
    },
  });
}

function useRecentDeposits() {
  return useQuery({
    queryKey: ["partner-deposits-recent"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_deposits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function DepositDialog({
  partner,
  onOpenChange,
}: {
  partner: PartnerBalance | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = parseAmount(amount);
  const held = partner?.held ?? 0;
  const valid = canDepositAmount(value, held);

  function reset() {
    setAmount("");
    setNote("");
    setFile(null);
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!partner) throw new Error("Sócio não selecionado.");
      const parsed = depositSchema.safeParse({ amount: value, note: note.trim() || undefined });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      }
      if (!canDepositAmount(value, held)) {
        throw new Error(
          `O depósito não pode passar do que o sócio tem em posse (${formatBRL(held)}).`,
        );
      }
      const photoPath = file ? await uploadDepositReceipt(file, partner.partner_id) : null;
      const { error: rpcError } = await supabase.rpc("create_partner_deposit", {
        _partner_id: partner.partner_id,
        _amount: parsed.data.amount,
        ...(parsed.data.note ? { _note: parsed.data.note } : {}),
        ...(photoPath ? { _photo_url: photoPath } : {}),
      });
      if (rpcError) throw rpcError;
      return parsed.data.amount;
    },
    onSuccess: (deposited) => {
      toast.success("Depósito registrado", { description: formatBRL(deposited) });
      void queryClient.invalidateQueries({ queryKey: ["partner-balances"] });
      void queryClient.invalidateQueries({ queryKey: ["partner-deposits-recent"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(friendlyError(err)),
  });

  return (
    <Dialog
      open={partner !== null}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar depósito no banco</DialogTitle>
          <DialogDescription>
            {partner
              ? `${partner.full_name} está com ${formatBRL(held)} em posse.`
              : "Selecione um sócio."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="dep-amount">Valor depositado (R$)</Label>
            <Input
              id="dep-amount"
              className="h-12 text-lg"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
            {amount.trim() !== "" && !valid ? (
              <p className="text-xs font-semibold text-destructive">
                {value <= 0
                  ? "Informe um valor maior que zero."
                  : `Não pode passar de ${formatBRL(held)} (o que o sócio tem em posse).`}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dep-note">Observação (opcional)</Label>
            <Textarea
              id="dep-note"
              maxLength={300}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: depósito Banco do Brasil, agência 0001"
            />
          </div>

          <ReceiptUpload
            file={file}
            onChange={setFile}
            required={false}
            label="Comprovante do banco (opcional)"
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="h-12 w-full" disabled={!valid || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {valid ? `Confirmar depósito de ${formatBRL(value)}` : "Informe o valor"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PartnerBalances() {
  const { data: balances, isLoading, isError, error } = usePartnerBalances();
  const { data: deposits } = useRecentDeposits();
  const [selected, setSelected] = useState<PartnerBalance | null>(null);

  const rows = balances ?? [];
  const totalHeld = rows.reduce((s, p) => s + p.held, 0);
  const totalWaiting = rows.reduce((s, p) => s + p.waiting, 0);
  const nameById = Object.fromEntries(rows.map((p) => [p.partner_id, p.full_name]));

  async function openReceipt(path: string) {
    const url = await getReceiptUrl(path);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Não foi possível abrir o comprovante");
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <section className="surface-panel p-5">
        <p className="text-sm text-destructive">{friendlyError(error as Error)}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="surface-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Em posse dos sócios (total)
          </p>
          <p className="mt-1 text-2xl font-semibold text-primary">{formatBRL(totalHeld)}</p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Aguardando confirmação
          </p>
          <p className="mt-1 text-2xl font-semibold">{formatBRL(totalWaiting)}</p>
        </div>
      </div>

      <section className="surface-panel p-5">
        <h2 className="text-lg">Sócios</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Em posse = retiradas confirmadas menos o que já foi depositado no banco.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nenhum sócio para exibir.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {rows.map((p) => (
              <div key={p.partner_id} className="rounded-lg border border-border/60 p-4">
                <p className="font-medium">{p.full_name}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Em posse
                    </p>
                    <p className="mt-0.5 text-xl font-semibold text-primary">{formatBRL(p.held)}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Aguardando confirmação
                    </p>
                    <p
                      className={`mt-0.5 text-xl font-semibold ${p.waiting > 0 ? "" : "text-muted-foreground"}`}
                    >
                      {formatBRL(p.waiting)}
                    </p>
                  </div>
                </div>
                <Button
                  className="mt-3 h-11 w-full"
                  disabled={p.held <= 0}
                  onClick={() => setSelected(p)}
                >
                  {p.held <= 0 ? "Nada em posse para depositar" : "Registrar depósito no banco"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface-panel p-5">
        <h2 className="text-lg">Depósitos recentes no banco</h2>
        {(deposits ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum depósito registrado ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {(deposits ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {nameById[d.partner_id] ?? "Sócio"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {depositAuthorLabel(d.created_by, d.partner_id)} ·{" "}
                    {new Date(d.created_at).toLocaleString("pt-BR")}
                  </p>
                  {d.note ? <p className="mt-0.5 text-xs text-muted-foreground">{d.note}</p> : null}
                  {d.photo_url ? (
                    <button
                      type="button"
                      className="mt-1 flex items-center gap-1 text-xs text-primary underline"
                      onClick={() => void openReceipt(d.photo_url!)}
                    >
                      <ImageIcon className="size-3.5" />
                      Ver comprovante
                    </button>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-semibold text-primary">
                  {formatBRL(d.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DepositDialog
        partner={selected}
        onOpenChange={(open) => (open ? null : setSelected(null))}
      />
    </div>
  );
}

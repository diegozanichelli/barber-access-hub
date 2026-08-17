import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

type Unit = { id: string; name: string };

async function fetchUnits(): Promise<Unit[]> {
  const { data, error } = await supabase.from("units").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

async function fetchUnitUserCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("profiles").select("unit_id");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.unit_id) counts[row.unit_id] = (counts[row.unit_id] ?? 0) + 1;
  }
  return counts;
}

async function countDependencies(unitId: string) {
  const tables = ["profiles", "shifts", "transactions", "partner_withdrawals"] as const;
  const labels: Record<(typeof tables)[number], string> = {
    profiles: "usuários",
    shifts: "turnos",
    transactions: "lançamentos",
    partner_withdrawals: "retiradas",
  };
  const blockers: string[] = [];
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unitId);
    if (error) throw error;
    if ((count ?? 0) > 0) blockers.push(`${count} ${labels[table]}`);
  }
  return blockers;
}

export function UnitManager() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Unit | null>(null);

  const { data: units, isLoading } = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const { data: userCounts } = useQuery({
    queryKey: ["unit-user-counts"],
    queryFn: fetchUnitUserCounts,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["units"] });
    void queryClient.invalidateQueries({ queryKey: ["unit-user-counts"] });
    void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
  };

  const nameTaken = (name: string, exceptId?: string) =>
    (units ?? []).some(
      (u) => u.id !== exceptId && u.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );

  const createUnit = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("units").insert({ name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Unidade criada");
      setNewName("");
      refresh();
    },
    onError: (e: Error) => toast.error("Erro ao criar unidade", { description: e.message }),
  });

  const renameUnit = useMutation({
    mutationFn: async (vars: { id: string; name: string }) => {
      const { error } = await supabase
        .from("units")
        .update({ name: vars.name.trim() })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Unidade renomeada");
      setEditingId(null);
      refresh();
    },
    onError: (e: Error) => toast.error("Erro ao renomear", { description: e.message }),
  });

  const deleteUnit = useMutation({
    mutationFn: async (unit: Unit) => {
      const blockers = await countDependencies(unit.id);
      if (blockers.length > 0) {
        throw new Error(
          `Esta unidade ainda possui ${blockers.join(", ")}. Remova ou realoque esses registros antes de excluir.`,
        );
      }
      const { error } = await supabase.from("units").delete().eq("id", unit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Unidade excluída");
      setPendingDelete(null);
      refresh();
    },
    onError: (e: Error) => {
      setPendingDelete(null);
      toast.error("Não foi possível excluir", { description: e.message });
    },
  });

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da unidade");
      return;
    }
    if (nameTaken(name)) {
      toast.error("Já existe uma unidade com esse nome");
      return;
    }
    createUnit.mutate(name);
  };

  const handleRename = (unit: Unit) => {
    const name = editName.trim();
    if (!name) {
      toast.error("Informe o nome da unidade");
      return;
    }
    if (nameTaken(name, unit.id)) {
      toast.error("Já existe uma unidade com esse nome");
      return;
    }
    renameUnit.mutate({ id: unit.id, name });
  };

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center gap-2">
        <Building2 className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg">Unidades</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Crie, renomeie ou remova as unidades da rede.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nome da unidade"
          aria-label="Nome da nova unidade"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <Button onClick={handleCreate} disabled={createUnit.isPending}>
          {createUnit.isPending ? <Loader2 className="size-4 animate-spin" /> : "Criar unidade"}
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-6 flex justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (units ?? []).length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nenhuma unidade cadastrada ainda.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {(units ?? []).map((unit) => (
            <li key={unit.id} className="rounded-lg border border-border/60 p-4">
              {editingId === unit.id ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label={`Novo nome de ${unit.name}`}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleRename(unit)}
                      disabled={renameUnit.isPending}
                    >
                      Salvar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{unit.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {userCounts?.[unit.id] ?? 0} usuário(s) vinculado(s)
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Renomear ${unit.name}`}
                      onClick={() => {
                        setEditingId(unit.id);
                        setEditName(unit.name);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Excluir ${unit.name}`}
                      onClick={() => setPendingDelete(unit)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir unidade</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja excluir a unidade “{pendingDelete?.name}”? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) deleteUnit.mutate(pendingDelete);
              }}
              disabled={deleteUnit.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

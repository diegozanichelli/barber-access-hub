import { createFileRoute } from "@tanstack/react-router";
import { TransactionDialog } from "@/components/transaction-dialog";

export const Route = createFileRoute("/dev-split-change")({
  component: DevSplitChange,
});

function DevSplitChange() {
  return (
    <TransactionDialog
      type="income"
      onOpenChange={() => undefined}
      shiftId="00000000-0000-0000-0000-000000000000"
      unitId="00000000-0000-0000-0000-000000000000"
      userId="00000000-0000-0000-0000-000000000000"
    />
  );
}

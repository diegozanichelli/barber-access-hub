import { useQuery } from "@tanstack/react-query";
import { ImageOff, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getReceiptUrl } from "@/lib/transactions";
import { useState } from "react";

export function ReceiptThumb({ path, alt }: { path: string | null; alt: string }) {
  const [open, setOpen] = useState(false);

  const { data: url, isLoading } = useQuery({
    queryKey: ["receipt-url", path],
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    queryFn: () => getReceiptUrl(path as string),
  });

  if (!path) {
    return (
      <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground">
        <ImageOff className="size-4" aria-hidden />
      </div>
    );
  }

  if (isLoading || !url) {
    return (
      <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-border/60">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="size-20 shrink-0 overflow-hidden rounded-lg border border-border/60 transition hover:ring-2 hover:ring-primary"
        aria-label={`Ampliar comprovante: ${alt}`}
      >
        <img src={url} alt={alt} className="size-full object-cover" loading="lazy" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-base">{alt}</DialogTitle>
          <img src={url} alt={alt} className="max-h-[75vh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

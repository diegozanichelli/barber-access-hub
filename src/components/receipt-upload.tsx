import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
  required: boolean;
  label?: string;
};

const MAX_BYTES = 10 * 1024 * 1024;

export function ReceiptUpload({ file, onChange, required, label = "Foto do comprovante" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function handleFile(next: File | null) {
    setError(null);
    if (!next) {
      setPreview(null);
      onChange(null);
      return;
    }
    if (!next.type.startsWith("image/")) {
      setError("Envie um arquivo de imagem.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setError("A imagem deve ter no máximo 10 MB.");
      return;
    }
    setPreview(URL.createObjectURL(next));
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? <span className="ml-1 text-destructive">*obrigatória</span> : " (opcional)"}
      </Label>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {preview ? (
        <div className="relative overflow-hidden rounded-lg border border-border">
          <img src={preview} alt="Pré-visualização do comprovante" className="h-40 w-full object-cover" />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute right-2 top-2"
            onClick={() => handleFile(null)}
            aria-label="Remover foto"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-16 w-full"
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="size-5" />
          Tirar foto / escolher imagem
        </Button>
      )}

      {file && !preview ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

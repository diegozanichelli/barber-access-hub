import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string | undefined;
  wide?: boolean;
  children?: ReactNode;
};

export function DashboardShell({ eyebrow, title, subtitle, wide, children }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="barber-stripes h-1.5 w-full" />
      <header className="flex items-center justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <Scissors className="size-5 text-primary" aria-hidden />
          <span className="font-display text-xl tracking-wide">Caixa Barber</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          <LogOut className="size-4" />
          Sair
        </Button>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-3xl leading-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        <div className="mt-6 space-y-4">{children}</div>
      </main>
    </div>
  );
}

export function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <section className="surface-panel border-dashed p-5">
      <h2 className="text-lg">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}

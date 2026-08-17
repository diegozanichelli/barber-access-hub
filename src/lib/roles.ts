export type AppRole = "atendente" | "supervisor" | "socio" | "auditor";

export const ROLE_LABELS: Record<AppRole, string> = {
  atendente: "Atendente",
  supervisor: "Supervisor",
  socio: "Sócio",
  auditor: "Auditor / Admin",
};

export const ROLE_ROUTES: Record<AppRole, string> = {
  atendente: "/atendente",
  supervisor: "/supervisor",
  socio: "/socio",
  auditor: "/auditor",
};

export const ROLE_ORDER: AppRole[] = ["atendente", "supervisor", "socio", "auditor"];

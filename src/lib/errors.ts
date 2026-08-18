/** Traduz erros técnicos do banco em mensagens que o atendente entende. */
export function friendlyError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : ((error as { message?: string })?.message ?? "");

  const message = raw.trim();
  if (!message) return "Não foi possível concluir. Tente de novo.";

  // Mensagens vindas das funções do banco já estão em português.
  if (/[áâãéêíóôõúç]/i.test(message) && !/violates|constraint|policy|JWT|schema/i.test(message)) {
    return message;
  }

  if (/row-level security|permission denied|not authorized/i.test(message)) {
    return "Você não tem permissão para esta ação nesta unidade.";
  }
  if (/duplicate key|shifts_one_open_per_unit/i.test(message)) {
    return "Já existe um caixa aberto nesta unidade. Atualize a tela.";
  }
  if (/JWT|token|session/i.test(message)) {
    return "Sua sessão expirou. Entre novamente.";
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  }
  if (/storage|bucket|upload/i.test(message)) {
    return "Não foi possível enviar a foto. Tente novamente.";
  }
  return message;
}

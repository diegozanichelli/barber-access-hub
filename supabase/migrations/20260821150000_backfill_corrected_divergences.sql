-- A migration 20260821140000 fez a correção de abertura encerrar a divergência
-- que a originou, mas só dali para a frente. As correções já feitas antes disso
-- deixaram divergências abertas na tela do auditor — o caso do Parque 10, em
-- que o master corrigiu a abertura de R$ 235,00 para R$ 215,00 e o alerta
-- vermelho continuou porque nada nunca mexia no status do turno anterior.
--
-- Este backfill aplica a mesma regra ao histórico: para cada correção de
-- abertura já registrada em cash_count_corrections, encerra a divergência do
-- turno da mesma unidade fechado imediatamente antes daquela abertura.
--
-- Idempotente: só toca turnos que ainda estão 'disputed', então rodar de novo
-- não faz nada. Divergências sem correção de abertura correspondente seguem
-- abertas de propósito — ninguém as resolveu ainda.
--
-- As contagens registradas não são alteradas. O que a supervisora contou na
-- hora continua sendo o histórico de auditoria; o que muda é só a marcação de
-- que o caso foi tratado, com resolved_by/resolved_at/resolution_note.
DO $$
DECLARE
  _closed integer;
BEGIN
  WITH corrections AS (
    SELECT
      c.corrected_by,
      c.previous_total,
      c.corrected_total,
      c.reason,
      c.created_at,
      s.unit_id,
      s.opened_at
    FROM public.cash_count_corrections c
    JOIN public.shifts s ON s.id = c.shift_id
  ),
  pairs AS (
    -- DISTINCT ON garante uma linha por divergência mesmo que a mesma abertura
    -- tenha sido corrigida várias vezes; a correção mais antiga é a que a
    -- resolveu, por isso o ORDER BY ascendente em created_at.
    SELECT DISTINCT ON (d.id)
      d.id AS disputed_id,
      k.corrected_by,
      k.previous_total,
      k.corrected_total,
      k.reason
    FROM corrections k
    JOIN LATERAL (
      SELECT s2.id
      FROM public.shifts s2
      WHERE s2.unit_id = k.unit_id
        AND s2.status = 'disputed'
        AND COALESCE(s2.closed_at, s2.opened_at) <= k.opened_at
      ORDER BY COALESCE(s2.closed_at, s2.opened_at) DESC
      LIMIT 1
    ) d ON TRUE
    ORDER BY d.id, k.created_at ASC
  )
  UPDATE public.shifts s
  SET
    status = 'closed',
    resolved_by = p.corrected_by,
    resolved_at = now(),
    -- to_char com ponto literal e replace para vírgula: independe do lc_numeric
    -- do servidor, que varia entre ambientes.
    resolution_note = format(
      'Encerrada retroativamente: abertura corrigida de R$ %s para R$ %s pelo master. Motivo: %s',
      replace(to_char(p.previous_total, 'FM999999990.00'), '.', ','),
      replace(to_char(p.corrected_total, 'FM999999990.00'), '.', ','),
      p.reason
    )
  FROM pairs p
  WHERE s.id = p.disputed_id
    AND s.status = 'disputed';

  GET DIAGNOSTICS _closed = ROW_COUNT;
  RAISE NOTICE 'Divergências encerradas retroativamente: %', _closed;
END;
$$;

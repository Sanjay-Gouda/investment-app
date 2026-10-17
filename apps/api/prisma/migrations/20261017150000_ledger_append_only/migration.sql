-- Append-only ledger: block UPDATE and DELETE on "LedgerEntry" at the database
-- level, so immutability holds even if application code or a bad migration ever
-- tries to mutate a row. Corrections (reversal + rebook) only ever INSERT.
--
-- Note: this is a per-row trigger, so it fires on UPDATE/DELETE but NOT on
-- TRUNCATE — test harnesses can still TRUNCATE to reset between runs.

CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'LedgerEntry is append-only: % is not allowed. Use a correction (reversal + rebook).',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entry_no_mutation ON "LedgerEntry";

CREATE TRIGGER ledger_entry_no_mutation
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_mutation();

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(projectRoot, "tmp", "JobRadar_paystack_recovery_leads.csv");
const outputPath = resolve(projectRoot, "tmp", "paystack_recovery_import.sql");
const templateKey = "paystack_abandoned_checkout_email_1";

const expectedColumns = [
  "email",
  "priority",
  "recovery_segment",
  "attempt_count",
  "statuses",
  "channels",
  "last_status",
  "last_channel",
  "last_gateway_response",
  "last_requested_amount_xof",
  "inferred_plan",
  "last_attempt_at",
  "reason",
  "template_key",
  "recommended_state",
];

const allowedPriorities = new Set(["P1", "P2"]);
const allowedSegments = new Set([
  "card_abandoned",
  "mobile_money_failed",
  "mobile_money_expired_or_abandoned",
  "multiple_attempts_without_success",
]);
const allowedStates = new Set(["pending", "queued", "sent", "cancelled", "skipped"]);
const normalizationMappings = {
  recommended_state: new Map([["ready_for_dry_run", "pending"]]),
  recovery_segment: new Map([["multiple_attempts_no_success", "multiple_attempts_without_success"]]),
};

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV invalide: guillemet non ferme.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim() !== ""));
}

function recordsFromCsv(content) {
  const parsed = parseCsv(content);
  if (parsed.length === 0) throw new Error("CSV vide.");

  const headers = parsed[0].map((header) => header.trim());
  const missing = expectedColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`Colonnes CSV manquantes: ${missing.join(", ")}`);
  }

  return parsed.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`Ligne ${index + 2}: ${values.length} valeurs pour ${headers.length} colonnes.`);
    }
    return Object.fromEntries(headers.map((header, position) => [header, values[position].trim()]));
  });
}

function requireNullableInteger(value, label, lineNumber) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error(`Ligne ${lineNumber}: ${label} doit etre un entier positif.`);
  return Number(value);
}

function normalizeRow(row, normalizationCounts) {
  const normalizedState = normalizationMappings.recommended_state.get(row.recommended_state);
  if (normalizedState) {
    normalizationCounts.recommended_state += 1;
    row.recommended_state = normalizedState;
  }

  const normalizedSegment = normalizationMappings.recovery_segment.get(row.recovery_segment);
  if (normalizedSegment) {
    normalizationCounts.recovery_segment += 1;
    row.recovery_segment = normalizedSegment;
  }

  return row;
}

function validateRow(row, index) {
  const lineNumber = index + 2;
  row.email = row.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    throw new Error(`Ligne ${lineNumber}: email invalide (${row.email || "vide"}).`);
  }
  if (!allowedPriorities.has(row.priority)) {
    throw new Error(`Ligne ${lineNumber}: priority invalide (${row.priority}).`);
  }
  if (!allowedSegments.has(row.recovery_segment)) {
    throw new Error(`Ligne ${lineNumber}: recovery_segment invalide (${row.recovery_segment}).`);
  }
  if (row.template_key && row.template_key !== templateKey) {
    throw new Error(`Ligne ${lineNumber}: template_key doit etre ${templateKey}.`);
  }
  row.template_key = templateKey;
  row.recommended_state = row.recommended_state || "pending";
  if (!allowedStates.has(row.recommended_state)) {
    throw new Error(`Ligne ${lineNumber}: recommended_state invalide (${row.recommended_state}).`);
  }
  row.attempt_count = requireNullableInteger(row.attempt_count, "attempt_count", lineNumber);
  row.last_requested_amount_xof = requireNullableInteger(
    row.last_requested_amount_xof,
    "last_requested_amount_xof",
    lineNumber,
  );
  if (row.last_attempt_at && Number.isNaN(Date.parse(row.last_attempt_at))) {
    throw new Error(`Ligne ${lineNumber}: last_attempt_at invalide (${row.last_attempt_at}).`);
  }
  return row;
}

function sqlText(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTimestamp(value) {
  return value ? `${sqlText(value)}::timestamptz` : "null";
}

function buildSql(rows) {
  const preface = "-- Generated from tmp/JobRadar_paystack_recovery_leads.csv. Review before manual execution.\n";
  const columns = expectedColumns.join(",\n  ");
  const values = rows.map((row) => `(
    ${sqlText(row.email)},
    ${sqlText(row.priority)},
    ${sqlText(row.recovery_segment)},
    ${row.attempt_count ?? "null"},
    ${sqlText(row.statuses)},
    ${sqlText(row.channels)},
    ${sqlText(row.last_status)},
    ${sqlText(row.last_channel)},
    ${sqlText(row.last_gateway_response)},
    ${row.last_requested_amount_xof ?? "null"},
    ${sqlText(row.inferred_plan)},
    ${sqlTimestamp(row.last_attempt_at)},
    ${sqlText(row.reason)},
    ${sqlText(row.template_key)},
    ${sqlText(row.recommended_state)}
  )`).join(",\n");

  return `${preface}begin;

insert into public.paystack_checkout_recovery_leads (
  ${columns}
)
values
${values}
on conflict (lower(btrim(email))) do update set
  priority = excluded.priority,
  recovery_segment = excluded.recovery_segment,
  attempt_count = excluded.attempt_count,
  statuses = excluded.statuses,
  channels = excluded.channels,
  last_status = excluded.last_status,
  last_channel = excluded.last_channel,
  last_gateway_response = excluded.last_gateway_response,
  last_requested_amount_xof = excluded.last_requested_amount_xof,
  inferred_plan = excluded.inferred_plan,
  last_attempt_at = excluded.last_attempt_at,
  reason = excluded.reason,
  template_key = excluded.template_key,
  recommended_state = case
    when paystack_checkout_recovery_leads.recommended_state = 'pending'
      then excluded.recommended_state
    else paystack_checkout_recovery_leads.recommended_state
  end,
  imported_at = now();

commit;
`; 
}

function distribution(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)));
}

function maskEmail(email) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart.slice(0, 2)}***@${domain}`;
}

if (!existsSync(inputPath)) {
  throw new Error(`CSV source introuvable: ${inputPath}. Aucun SQL ni fixture ne sera genere.`);
}

const sourceRows = recordsFromCsv(await readFile(inputPath, "utf8"));
const normalizationCounts = { recommended_state: 0, recovery_segment: 0 };
const rows = sourceRows
  .map((row) => normalizeRow({ ...row }, normalizationCounts))
  .map((row, index) => validateRow(row, index));

if (rows.length === 0) throw new Error("Aucun lead a generer.");
if (new Set(rows.map((row) => row.email)).size !== rows.length) {
  throw new Error("Le CSV contient plusieurs lignes pour le meme email normalise.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, buildSql(rows), "utf8");

console.log(JSON.stringify({
  source_file: inputPath,
  output_file: outputPath,
  csv_rows_read: sourceRows.length,
  sql_leads_generated: rows.length,
  invalid_email_count: 0,
  duplicate_email_count: 0,
  priority_distribution: distribution(rows, "priority"),
  recovery_segment_distribution: distribution(rows, "recovery_segment"),
  recommended_state_distribution: distribution(rows, "recommended_state"),
  recommended_state_normalized_count: normalizationCounts.recommended_state,
  recovery_segment_normalized_count: normalizationCounts.recovery_segment,
  normalization_mappings: {
    recommended_state: {
      ready_for_dry_run: "pending",
    },
    recovery_segment: {
      multiple_attempts_no_success: "multiple_attempts_without_success",
    },
  },
  sample_leads: rows.slice(0, 5).map((row) => ({
    email: maskEmail(row.email),
    priority: row.priority,
    recovery_segment: row.recovery_segment,
    attempt_count: row.attempt_count,
    last_status: row.last_status,
    last_channel: row.last_channel,
    inferred_plan: row.inferred_plan,
    recommended_state: row.recommended_state,
  })),
}, null, 2));

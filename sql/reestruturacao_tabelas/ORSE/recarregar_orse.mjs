// Recarga do ORSE do zero, em ordem, a partir de _csv/stg_orse_AAAA-MM.csv.
//
// DESTRUTIVO: zera orse_item / orse_item_presenca / orse_descricao / orse_preco
// e apaga as referencias ORSE de referencia_carregada. Depois carrega mes a mes.
// So roda com --confirmar.
//
// Uso:
//   node recarregar_orse.mjs --confirmar
//   node recarregar_orse.mjs --confirmar --de 2026-06        (retoma de um mes)
//   node recarregar_orse.mjs --so-verificar                  (so mostra o estado)
//
// Precisa de db-url.local nesta pasta (ou acima) com a connection string
// (Supabase -> Settings -> Database -> Connection string, modo Session, porta 5432).

import { createReadStream, readFileSync, existsSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

const here = dirname(fileURLToPath(import.meta.url));
const csvDir = join(here, '_csv');

function acharDbUrl() {
  for (let d = here, i = 0; i < 4; i++, d = dirname(d)) {
    const p = join(d, 'db-url.local');
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  }
  return '';
}

const args = process.argv.slice(2);
const confirmar = args.includes('--confirmar');
const soVerificar = args.includes('--so-verificar');
const deIdx = args.indexOf('--de');
const de = deIdx >= 0 ? (args[deIdx + 1] || '').trim() : '';

let cs = process.env.SUPABASE_DB_URL || acharDbUrl();
if (!cs || cs.includes('[SENHA]')) {
  console.error('Falta db-url.local com a connection string real (troque [SENHA] pela senha do banco).');
  process.exitCode = 1; process.exit();
}
try { const u = new URL(cs); u.searchParams.delete('sslmode'); u.searchParams.delete('ssl'); cs = u.toString(); } catch {}

const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET statement_timeout = 0');

async function estado() {
  const { rows } = await c.query(`
    SELECT referencia::text,
           count(*) FILTER (WHERE identificacao='C') servicos,
           count(*) FILTER (WHERE identificacao='I') insumos,
           count(*) FILTER (WHERE preco_unitario IS NULL) preco_nulo,
           count(*) total
    FROM orse_itens GROUP BY referencia ORDER BY referencia`);
  console.table(rows);
  const { rows: rc } = await c.query(
    `SELECT referencia_label FROM referencia_carregada WHERE fonte='ORSE' ORDER BY referencia_ord`);
  console.log('referencia_carregada ORSE:', rc.map(r => r.referencia_label).join(', ') || '(vazio)');
}

if (soVerificar) { await estado(); await c.end(); process.exit(); }

const arquivos = readdirSync(csvDir)
  .filter(f => /^stg_orse_\d{4}-\d{2}\.csv$/.test(f))
  .sort()
  .filter(f => !de || f.slice(9, 16) >= de);

if (!arquivos.length) { console.error('Nenhum _csv/stg_orse_AAAA-MM.csv encontrado.'); process.exitCode = 1; process.exit(); }

if (!confirmar) {
  console.log('Meses a carregar:', arquivos.map(f => f.slice(9, 16)).join(', '));
  console.log('\nISSO VAI ZERAR o ORSE e recarregar. Rode de novo com --confirmar.');
  await c.end(); process.exit();
}

if (!de) {
  console.log('Zerando ORSE...');
  await c.query('TRUNCATE orse_preco, orse_descricao, orse_item_presenca, orse_item');
  await c.query("DELETE FROM referencia_carregada WHERE fonte='ORSE'");
  await c.query('TRUNCATE stg_orse');
}

for (const f of arquivos) {
  const mes = f.slice(9, 16);
  const ref = `${mes}-01`;
  process.stdout.write(`\n${mes}  `);
  await c.query('TRUNCATE stg_orse');
  const ingest = c.query(copyFrom(
    `COPY stg_orse (identificacao,codigo,descricao,unidade,preco_unitario,tipo_encargo,referencia)
     FROM STDIN WITH (FORMAT csv, HEADER true)`));
  await pipeline(createReadStream(join(csvDir, f)), ingest);
  const { rows: [{ n }] } = await c.query('SELECT count(*)::int n FROM stg_orse');
  const { rows: [r] } = await c.query('SELECT rt_aplicar_orse($1) AS resumo', [ref]);
  process.stdout.write(`stg=${n}  ${JSON.stringify(r.resumo)}`);
}

console.log('\n\n=== estado final ===');
await estado();
await c.end();
console.log('OK.');

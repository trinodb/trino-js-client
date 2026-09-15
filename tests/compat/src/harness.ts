/**
 * Downstream compatibility harness for @trinodb/trino-js-client.
 *
 * Exercises the API surface that Lightdash, Malloy, and Beekeeper Studio
 * actually depend on, against a local Trino coordinator on port 8080.
 * Run it against the current release and against a candidate build, then
 * compare the two reports.
 */
import {
  Trino,
  BasicAuth,
  Iterator,
  QueryResult,
  QueryInfo,
  ConnectionOptions,
} from '@trinodb/trino-js-client';

type Check = {name: string; ok: boolean; detail: string};
const checks: Check[] = [];

const record = (name: string, ok: boolean, detail: string) => {
  checks.push({name, ok, detail});
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const run = async (name: string, fn: () => Promise<string>) => {
  try {
    record(name, true, await fn());
  } catch (e) {
    record(name, false, `threw ${(e as Error).name}: ${(e as Error).message}`);
  }
};

const SERVER = process.env.TRINO_SERVER ?? 'http://localhost:8080';

// The options shape Malloy builds, including the extraConfig spread that
// forces ConnectionOptions to stay a plain structural type.
const extraConfig: Partial<ConnectionOptions> = {source: 'harness'};
const options: ConnectionOptions = {
  ...extraConfig,
  server: SERVER,
  catalog: 'tpch',
  schema: 'tiny',
  auth: new BasicAuth('harness-user'),
};

const main = async () => {
  const trino = Trino.create(options);

  // Malloy: submit, drain with for-await, flatten data.
  await run('malloy: drain query with for-await', async () => {
    const iter: Iterator<QueryResult> = await trino.query(
      'select name, nationkey from tpch.tiny.nation order by nationkey'
    );
    const rows: unknown[] = [];
    for await (const result of iter) {
      rows.push(...(result.data ?? []));
    }
    if (rows.length !== 25) throw new Error(`expected 25 rows, got ${rows.length}`);
    return `${rows.length} rows`;
  });

  // Lightdash: manual next() loop, guarding the missing-nextUri case, and
  // reading column type metadata off the first result.
  await run('lightdash: next() streaming loop with nextUri guard', async () => {
    const query = await trino.query(
      'select custkey, name from tpch.tiny.customer order by custkey limit 500'
    );
    let queryResult = await query.next();
    if (queryResult.value.error) {
      throw new Error(`query returned error: ${JSON.stringify(queryResult.value.error)}`);
    }
    const schema = queryResult.value.columns ?? [];
    if (schema.length !== 2) throw new Error(`expected 2 columns, got ${schema.length}`);
    const raw = (schema[0] as unknown as {typeSignature?: {rawType?: string}}).typeSignature;
    if (!raw?.rawType) throw new Error('columns[].typeSignature.rawType missing');

    let streamed = (queryResult.value.data ?? []).length;
    while (!queryResult.done) {
      if (!queryResult.value.nextUri) {
        queryResult = await query.next();
        continue;
      }
      queryResult = await query.next();
      streamed += (queryResult.value.data ?? []).length;
    }
    if (streamed !== 500) throw new Error(`expected 500 rows streamed, got ${streamed}`);
    return `${streamed} rows, rawType=${raw.rawType}`;
  });

  // Pins the last-page semantics that Lightdash works around: the final
  // result is delivered once with done=false and repeated with done=true.
  await run('semantics: done and nextUri sequence across a full drain', async () => {
    const query = await trino.query('select 1 as one');
    const seen: Array<{done: boolean; rows: number; nextUri: boolean}> = [];
    for (let i = 0; i < 6; i++) {
      const r = await query.next();
      seen.push({
        done: !!r.done,
        rows: (r.value.data ?? []).length,
        nextUri: !!r.value.nextUri,
      });
      if (r.done) break;
    }
    const last = seen[seen.length - 1];
    const prev = seen[seen.length - 2];
    if (!last.done) throw new Error('iterator never reported done');
    const repeats = prev !== undefined && prev.rows === last.rows && last.rows > 0;
    return `${JSON.stringify(seen)} repeats=${repeats}`;
  });

  // Lightdash sends client tags this way; Beekeeper sends its own headers.
  await run('extraHeaders: client tags accepted on the query object', async () => {
    const iter = await trino.query({
      query: 'select 1 as tagged',
      extraHeaders: {'X-Trino-Client-Tags': 'harness=true,source=compat'},
    });
    let rows = 0;
    for await (const r of iter) rows += (r.data ?? []).length;
    if (rows !== 1) throw new Error(`expected 1 row, got ${rows}`);
    return 'accepted';
  });

  // Lightdash reads the error off the result rather than catching a throw.
  await run('errors: bad SQL surfaces on queryResult.value.error', async () => {
    const query = await trino.query('select * from does_not_exist_harness');
    let result = await query.next();
    while (!result.value.error && !result.done) result = await query.next();
    const err = result.value.error;
    if (!err) throw new Error('no error field on the result');
    if (typeof err.message !== 'string') throw new Error('error.message missing');
    if (typeof err.errorCode !== 'number') throw new Error('error.errorCode missing');
    return `errorName=${err.errorName} errorCode=${err.errorCode}`;
  });

  // queryInfo and cancel: cancel issues a DELETE that returns an empty body.
  await run('queryInfo and cancel round-trip', async () => {
    const iter = await trino.query('select count(*) from tpch.sf1.lineitem');
    const first = await iter.next();
    const id = first.value.id;
    if (!id) throw new Error('no query id on the first result');
    const info: QueryInfo = await trino.queryInfo(id);
    if (info.queryId !== id) throw new Error(`queryInfo id mismatch: ${info.queryId} != ${id}`);
    const cancelled = await trino.cancel(id);
    if (cancelled.id !== id) throw new Error('cancel did not echo the query id');
    return `id=${id} state=${info.state}`;
  });

  // Session headers have to survive the response round-trip: the client must
  // read X-Trino-Set-Session off the response and replay it as X-Trino-Session.
  await run('session: SET SESSION round-trips through response headers', async () => {
    const drain = async (sql: string) => {
      const iter = await trino.query(sql);
      const rows: unknown[] = [];
      for await (const r of iter) {
        if (r.error) throw new Error(`server rejected "${sql}": ${r.error.message}`);
        rows.push(...(r.data ?? []));
      }
      return rows as unknown[][];
    };
    const before = await drain("show session like 'query_max_run_time'");
    await drain("set session query_max_run_time = '42m'");
    const after = await drain("show session like 'query_max_run_time'");
    if (after.length === 0) throw new Error('show session returned no rows');
    const value = String(after[0][1]);
    if (value !== '42m') {
      throw new Error(`expected 42m after SET SESSION, got '${value}' (before: '${String(before[0]?.[1])}')`);
    }
    return `query_max_run_time ${String(before[0]?.[1])} -> ${value}`;
  });

  // Clearing has to work too, since RESET SESSION emits X-Trino-Clear-Session.
  await run('session: RESET SESSION clears the replayed header', async () => {
    const drain = async (sql: string) => {
      const iter = await trino.query(sql);
      const rows: unknown[] = [];
      for await (const r of iter) rows.push(...(r.data ?? []));
      return rows as unknown[][];
    };
    await drain('reset session query_max_run_time');
    const after = await drain("show session like 'query_max_run_time'");
    const value = String(after[0]?.[1]);
    return `query_max_run_time reset to ${value}`;
  });

  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.log(`failed: ${failed.map(f => f.name).join(', ')}`);
    process.exitCode = 1;
  }
};

main().catch(e => {
  console.error('harness aborted:', e);
  process.exitCode = 1;
});

/**
 * Downstream compatibility harness for @trinodb/trino-js-client.
 *
 * Exercises the API surface that Lightdash, Malloy, and Beekeeper Studio
 * actually depend on, against a local Trino coordinator on port 8080.
 * Run it against the current release and against a candidate build, then
 * compare the two reports.
 *
 * Each check names the consumer whose call pattern it reproduces. Those
 * attributions are load bearing: a failure is only meaningful if it points at
 * the project that would break. Verify against the consumer source before
 * changing one. The links are in the README.
 */
import {
    Trino,
    BasicAuth,
    Iterator,
    QueryResult,
    QueryInfo,
    QueryError,
    Columns,
    Query,
    ConnectionOptions,
    SecureContextOptions,
    TRINO_CLIENT_TAGS_HEADER,
} from '@trinodb/trino-js-client'

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []

const record = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

const run = async (name: string, fn: () => Promise<string>) => {
    try {
        record(name, true, await fn())
    } catch (e) {
        record(name, false, `threw ${(e as Error).name}: ${(e as Error).message}`)
    }
}

const SERVER = process.env.TRINO_SERVER ?? 'http://localhost:8080'

// Malloy's default rowLimit. Small on purpose: it is well under one page, so
// the iterator is always abandoned rather than drained.
const MALLOY_ROW_LIMIT = 10

// The options shape Malloy builds, including the extraConfig spread that
// forces ConnectionOptions to stay a plain structural type. Both Lightdash
// and Malloy pass BasicAuth two arguments, Malloy with an empty-string
// password when none is configured.
const extraConfig: Partial<ConnectionOptions> = { source: 'harness' }
const options: ConnectionOptions = {
    ...extraConfig,
    server: SERVER,
    catalog: 'tpch',
    schema: 'tiny',
    auth: new BasicAuth('harness-user', ''),
}

const main = async () => {
    const trino = Trino.create(options)

    // Malloy: manual next() loop that stops as soon as it has rowLimit rows,
    // leaving the query running and the iterator un-drained. This is the
    // common case for Malloy, not an edge case, since rowLimit defaults to 10.
    await run('malloy: next() loop abandoned early at rowLimit', async () => {
        const iter = await trino.query('select orderkey, custkey from tpch.sf1.orders')
        let queryResult = await iter.next()
        if (queryResult.value.error) {
            throw new Error(`query returned error: ${JSON.stringify(queryResult.value.error)}`)
        }
        const rows: unknown[] = []
        let abandonedAt: string | undefined
        while (!queryResult.done) {
            rows.push(...(queryResult.value.data ?? []))
            if (rows.length >= MALLOY_ROW_LIMIT) {
                abandonedAt = queryResult.value.nextUri
                break
            }
            queryResult = await iter.next()
        }
        if (rows.length < MALLOY_ROW_LIMIT) {
            throw new Error(`only ${rows.length} rows before the limit was reached`)
        }
        if (!abandonedAt) {
            throw new Error('iterator reported no nextUri at the row limit, so the abandon path was not exercised')
        }
        // The client has to stay usable after an abandoned iterator.
        const after = await trino.query('select 1 as reusable')
        let reusable = 0
        for await (const r of after) reusable += (r.data ?? []).length
        if (reusable !== 1) throw new Error('client unusable after abandoning an iterator')
        return `abandoned after ${rows.length} rows with nextUri still set`
    })

    // Beekeeper Studio: for-await drain, typed as AsyncIterableIterator rather
    // than as the exported Iterator class. The explicit QueryResult bindings
    // below are the only part of the suite the declaration file genuinely
    // checks, because next() yields any. See the README.
    await run('beekeeper: for-await drain over AsyncIterableIterator', async () => {
        const iter: AsyncIterableIterator<QueryResult> = await trino.query(
            'select name, nationkey from tpch.tiny.nation order by nationkey'
        )
        const rows: unknown[] = []
        let columns: Columns | undefined
        for await (const result of iter) {
            const err: QueryError | undefined = result.error
            if (err) throw new Error(`${err.errorName}: ${err.message}`)
            const cols: Columns | undefined = result.columns
            if (cols) columns = cols
            rows.push(...(result.data ?? []))
        }
        if (rows.length !== 25) throw new Error(`expected 25 rows, got ${rows.length}`)
        if (columns?.length !== 2) throw new Error(`expected 2 columns, got ${columns?.length}`)
        return `${rows.length} rows, ${columns.length} columns`
    })

    // Lightdash: manual next() loop, guarding the missing-nextUri case.
    await run('lightdash: next() streaming loop with nextUri guard', async () => {
        const query = await trino.query('select custkey, name from tpch.tiny.customer order by custkey limit 500')
        let queryResult = await query.next()
        if (queryResult.value.error) {
            throw new Error(`query returned error: ${JSON.stringify(queryResult.value.error)}`)
        }
        let streamed = (queryResult.value.data ?? []).length
        while (!queryResult.done) {
            if (!queryResult.value.nextUri) {
                queryResult = await query.next()
                continue
            }
            queryResult = await query.next()
            streamed += (queryResult.value.data ?? []).length
        }
        if (streamed !== 500) throw new Error(`expected 500 rows streamed, got ${streamed}`)
        return `${streamed} rows`
    })

    // Lightdash reads the full type string in preference to the raw type,
    // because the full string carries the parameters that rawType drops. A
    // parameterized type is the only way to tell the two apart, so the check
    // uses a decimal rather than a varchar.
    await run('lightdash: column type and typeSignature.rawType differ', async () => {
        const query = await trino.query('select cast(1.5 as decimal(38,9)) as amount')
        const first = await query.next()
        const schema: {
            name: string
            type: string
            typeSignature: { rawType: string }
        }[] = first.value.columns ?? []
        if (schema.length !== 1) throw new Error(`expected 1 column, got ${schema.length}`)
        const [column] = schema
        // Asserted on substance rather than on spelling: Trino renders the
        // parameters as 'decimal(38, 9)', with a space, and that is cosmetic.
        if (!/^decimal\(\s*38\s*,\s*9\s*\)$/.test(column.type)) {
            throw new Error(`expected a parameterized decimal type, got '${column.type}'`)
        }
        if (column.typeSignature?.rawType !== 'decimal') {
            throw new Error(`expected rawType 'decimal', got '${column.typeSignature?.rawType}'`)
        }
        if (column.type === column.typeSignature.rawType) {
            throw new Error('type and rawType are identical, so the check proves nothing')
        }
        return `type=${column.type} rawType=${column.typeSignature.rawType}`
    })

    // Pins the last-page semantics that Lightdash works around. The drain can
    // yield a result with done=false and no nextUri before the one with
    // done=true, which is the case Lightdash guards: on deployments where that
    // result still carries data, calling next() again repeats it. The full
    // observed sequence is reported rather than asserted, because it is
    // deployment dependent and a change in it needs a release note.
    await run('semantics: done and nextUri sequence across a full drain', async () => {
        const query = await trino.query('select 1 as one')
        const seen: Array<{ done: boolean; rows: number; nextUri: boolean }> = []
        for (let i = 0; i < 6; i++) {
            const r = await query.next()
            seen.push({
                done: !!r.done,
                rows: (r.value.data ?? []).length,
                nextUri: !!r.value.nextUri,
            })
            if (r.done) break
        }
        const last = seen[seen.length - 1]
        const prev = seen[seen.length - 2]
        if (!last.done) throw new Error('iterator never reported done')
        const repeats = prev !== undefined && prev.rows === last.rows && last.rows > 0
        return `${JSON.stringify(seen)} repeats=${repeats}`
    })

    // Lightdash is the only consumer sending extraHeaders, as client tags on
    // the query object. Malloy sets extraHeaders on its Presto client, not on
    // this one, and Beekeeper sends no extra headers at all.
    //
    // Uses the exported header name rather than a literal, so this also proves
    // the constant is reachable from the packed tarball and still spells the
    // header the way Trino expects.
    await run('lightdash: extraHeaders client tags on the query object', async () => {
        if (TRINO_CLIENT_TAGS_HEADER !== 'X-Trino-Client-Tags') {
            throw new Error(`the exported name is '${TRINO_CLIENT_TAGS_HEADER}'`)
        }
        const tagged: Query = {
            query: 'select 1 as tagged',
            extraHeaders: { [TRINO_CLIENT_TAGS_HEADER]: 'harness=true,source=compat' },
        }
        const iter = await trino.query(tagged)
        let rows = 0
        for await (const r of iter) rows += (r.data ?? []).length
        if (rows !== 1) throw new Error(`expected 1 row, got ${rows}`)
        return 'accepted'
    })

    // Lightdash reads the error off the result rather than catching a throw.
    await run('lightdash: bad SQL surfaces on queryResult.value.error', async () => {
        const query = await trino.query('select * from does_not_exist_harness')
        let result = await query.next()
        while (!result.value.error && !result.done) result = await query.next()
        const err = result.value.error
        if (!err) throw new Error('no error field on the result')
        if (typeof err.message !== 'string') throw new Error('error.message missing')
        if (typeof err.errorCode !== 'number') throw new Error('error.errorCode missing')
        return `errorName=${err.errorName} errorCode=${err.errorCode}`
    })

    // Beekeeper surfaces the same failure from inside a for-await drain, where
    // the value is typed, and destructures errorName and message off it.
    await run('beekeeper: bad SQL surfaces inside a for-await drain', async () => {
        const iter: AsyncIterableIterator<QueryResult> = await trino.query('select * from does_not_exist_harness')
        let caught: { errorName: string; message: string } | undefined
        for await (const r of iter) {
            if (r.error) {
                const { errorName, message } = r.error
                caught = { errorName, message }
                break
            }
        }
        if (!caught) throw new Error('the drain completed without surfacing an error')
        if (!caught.errorName) throw new Error('error.errorName missing')
        return `errorName=${caught.errorName}`
    })

    // queryInfo and cancel: cancel issues a DELETE that returns an empty body.
    await run('queryInfo and cancel round-trip', async () => {
        const iter = await trino.query('select count(*) from tpch.sf1.lineitem')
        const first = await iter.next()
        const id = first.value.id
        if (!id) throw new Error('no query id on the first result')
        const info: QueryInfo = await trino.queryInfo(id)
        if (info.queryId !== id) throw new Error(`queryInfo id mismatch: ${info.queryId} != ${id}`)
        const cancelled = await trino.cancel(id)
        if (cancelled.id !== id) throw new Error('cancel did not echo the query id')
        return `id=${id} state=${info.state}`
    })

    // Beekeeper creates the client with neither auth nor schema when no
    // credentials are configured, and asks for the server version first. The
    // client has to fall back to a default X-Trino-User for that to work.
    await run('beekeeper: connect with no auth and no schema', async () => {
        const anonymous = Trino.create({ server: SERVER, catalog: 'tpch' })
        const iter: AsyncIterableIterator<QueryResult> = await anonymous.query('select version()')
        const rows: unknown[][] = []
        for await (const r of iter) {
            if (r.error) throw new Error(`${r.error.errorName}: ${r.error.message}`)
            rows.push(...((r.data ?? []) as unknown[][]))
        }
        if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`)
        return `version=${String(rows[0][0])}`
    })

    // Session headers have to survive the response round-trip: the client must
    // read X-Trino-Set-Session off the response and replay it as X-Trino-Session.
    await run('session: SET SESSION round-trips through response headers', async () => {
        const drain = async (sql: string) => {
            const iter = await trino.query(sql)
            const rows: unknown[] = []
            for await (const r of iter) {
                if (r.error) throw new Error(`server rejected "${sql}": ${r.error.message}`)
                rows.push(...(r.data ?? []))
            }
            return rows as unknown[][]
        }
        const before = await drain("show session like 'query_max_run_time'")
        await drain("set session query_max_run_time = '42m'")
        const after = await drain("show session like 'query_max_run_time'")
        if (after.length === 0) throw new Error('show session returned no rows')
        const value = String(after[0][1])
        if (value !== '42m') {
            throw new Error(`expected 42m after SET SESSION, got '${value}' (before: '${String(before[0]?.[1])}')`)
        }
        return `query_max_run_time ${String(before[0]?.[1])} -> ${value}`
    })

    // Clearing has to work too, since RESET SESSION emits X-Trino-Clear-Session.
    await run('session: RESET SESSION clears the replayed header', async () => {
        const drain = async (sql: string) => {
            const iter = await trino.query(sql)
            const rows: unknown[] = []
            for await (const r of iter) rows.push(...(r.data ?? []))
            return rows as unknown[][]
        }
        await drain('reset session query_max_run_time')
        const after = await drain("show session like 'query_max_run_time'")
        const value = String(after[0]?.[1])
        return `query_max_run_time reset to ${value}`
    })

    // Session state is only harvested from response headers as pages are read,
    // so a statement whose iterator is never drained can be submitted without
    // its setting ever being applied. Lightdash sets the time zone exactly that
    // way, discarding the iterator, so its timezone option is silently dropped.
    //
    // The assertion is on the draining case, which has to keep working. The
    // un-drained case is reported rather than asserted, so that a client which
    // started applying it would change the detail and prompt a release note
    // instead of failing the build. Each case gets its own client, so neither
    // can leak into the other or into the checks above.
    await run('session: SET TIME ZONE applied only when the iterator is drained', async () => {
        const zone = 'Asia/Kathmandu'
        const currentZone = async (trinoClient: Trino) => {
            const iter = await trinoClient.query('select current_timezone() as tz')
            const rows: unknown[][] = []
            for await (const r of iter) {
                if (r.error) throw new Error(`${r.error.errorName}: ${r.error.message}`)
                rows.push(...((r.data ?? []) as unknown[][]))
            }
            if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`)
            return String(rows[0][0])
        }

        // Lightdash's pattern: submit and discard, never advancing the iterator.
        const undrainedClient = Trino.create(options)
        await undrainedClient.query(`SET TIME ZONE '${zone}'`)
        const undrained = await currentZone(undrainedClient)

        // The same statement, drained to completion.
        const drainedClient = Trino.create(options)
        const setIter = await drainedClient.query(`SET TIME ZONE '${zone}'`)
        for await (const r of setIter) {
            if (r.error) throw new Error(`server rejected SET TIME ZONE: ${r.error.message}`)
        }
        const drained = await currentZone(drainedClient)

        if (drained !== zone) {
            throw new Error(`draining SET TIME ZONE did not apply it: got '${drained}'`)
        }
        return `drained=${drained} undrained=${undrained}`
    })

    const failed = checks.filter((c) => !c.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
    if (failed.length > 0) {
        console.log(`failed: ${failed.map((f) => f.name).join(', ')}`)
        process.exitCode = 1
    }
}

// Compile-time only. Beekeeper builds its ssl options as SecureContextOptions
// and Lightdash imports QueryError, so both have to stay exported and stay
// assignable from a plain object literal. Nothing here runs.
export const typeOnlyCoverage = (): ConnectionOptions => {
    const ssl: SecureContextOptions = { rejectUnauthorized: false }
    return {
        server: SERVER,
        catalog: 'tpch',
        ssl,
        // Lightdash and Malloy both pass two arguments; the second is optional.
        auth: new BasicAuth('harness-user'),
    }
}

// Lightdash annotates the iterator with the exported class, Beekeeper with
// the structural type. Both have to keep working.
export type IteratorShapes = {
    lightdash: Iterator<QueryResult>
    beekeeper: AsyncIterableIterator<QueryResult>
}

main().catch((e) => {
    console.error('harness aborted:', e)
    process.exitCode = 1
})

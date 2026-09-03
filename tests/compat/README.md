# Downstream compatibility tests

These checks run against the **packed tarball**, not against `src`. They
install the client the way a consumer installs it from npm, so they cover the
build output, the generated declaration file, and the package manifest, none of
which the integration tests in `tests/it` exercise.

## What they cover

The checks reproduce the call patterns of the largest consumers of this client
rather than the patterns of its own tests, and each check names the consumer it
stands in for:

- **Lightdash** drives it through a manual `next()` loop in
  [`TrinoWarehouseClient.ts`](https://github.com/lightdash/lightdash/blob/main/packages/warehouses/src/warehouseClients/TrinoWarehouseClient.ts)
- **Malloy** also uses a manual `next()` loop, in
  [`trino_connection.ts`](https://github.com/malloydata/malloy/blob/main/packages/malloy-db-trino/src/trino_connection.ts),
  but stops as soon as it has `rowLimit` rows
- **Beekeeper Studio** is the one consumer that drains with `for await`, in
  [`trino.ts`](https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src-commercial/backend/lib/db/clients/trino.ts)

Keep those attributions accurate. A failing check is only useful if it names
the project that would actually break, so check the consumer source before
changing one.

Between them they depend on:

* `Trino.create` with `ConnectionOptions` spread from a partial config, and
  with neither `auth` nor `schema` set
* `BasicAuth`, with and without a password
* the result of `query`, annotated both as the exported `Iterator<QueryResult>`
  and as a structural `AsyncIterableIterator<QueryResult>`
* draining with `for await`, draining with `next()`, and **abandoning** a
  `next()` loop with `nextUri` still set
* the observable `done` and `nextUri` sequence, including a result that
  reports `done=false` with no `nextUri`
* `extraHeaders` on the query object, used to send client tags
* column metadata through both `columns[].type` and
  `columns[].typeSignature.rawType`, which differ for a parameterized type
* errors read off `queryResult.error` rather than caught as a thrown exception,
  from inside both loop styles
* `queryInfo` and `cancel`, where the cancel issues a `DELETE` that returns an
  empty body
* `SET SESSION` and `RESET SESSION` replaying through the response headers,
  and `SET TIME ZONE` both drained and left un-drained

## What the type check does and does not cover

`tsconfig.json` sets `skipLibCheck: false` deliberately, so `dist/index.d.ts`
is checked the way a consumer's build checks it. That check has real but
limited reach, and it is worth being precise about where.

`Iterator.next()` returns `Promise<IteratorResult<T>>`. Because
`IteratorResult<T, TReturn = any>` defaults its return type to `any`, the
`value` of a settled result widens to `any`, so **nothing** read off
`queryResult.value` is type checked. Under `strict`, with
`skipLibCheck: false`, this compiles clean:

```ts
const nonsense: {absolutelyNotAField: symbol} = (await query.next()).value;
```

That covers the pattern Lightdash and Malloy both use, so a regression in the
`QueryResult` shape would not be caught there. The `for await` path yields a
properly typed `QueryResult`, so the explicitly annotated bindings in the
Beekeeper checks, and the type-only declarations at the foot of the harness,
are what actually pin the declaration file.

One known mismatch is deliberately not encoded as a check. `ConnectionOptions`
declares every property `readonly`, and Beekeeper builds its options by
assigning to `.ssl` and `.auth` after the fact, which is a type error:

```
error TS2540: Cannot assign to 'ssl' because it is a read-only property.
```

Beekeeper does not hit it because it builds with esbuild and Vite and has no
`tsc` step. A check reproducing it would not compile, so the harness builds its
options in a single literal, as Lightdash and Malloy do, and this note carries
the rest.

`Columns` is declared as `{name: string; type: string}[]` and does not declare
`typeSignature`. Lightdash reads that field anyway, and gets away with it only
because `next()` yields `any`. Malloy does not read it, but it does pass
`columns` straight through to a non-optional property, so typing the `next()`
path reaches Malloy too, through the `| undefined` that a real `Columns`
carries. Either change is breaking, so both belong to a major release rather
than to a patch.

## Running them locally

Start a coordinator, then run the script:

```shell
docker run -d --name trino-test -p 8080:8080 trinodb/trino:latest
until curl -s http://localhost:8080/v1/info | grep -q '"starting":false'; do
  sleep 2
done
yarn test:compat
```

Point the harness at a different coordinator with `TRINO_SERVER`.

## Refreshing the harness

The checks are a snapshot of how other projects call this client, so they go
stale on their own as those projects change. Nothing fails when they do; the
suite keeps passing while testing the wrong thing, which is the failure mode to
guard against. Refresh it when preparing a release, and when a consumer reports
a problem the suite did not catch.

Work through it consumer by consumer, using the links in
[What they cover](#what-they-cover):

1. Read the current consumer source and note every call into this client:
   imported symbols, the shape passed to `Trino.create`, how the iterator is
   annotated, how it is drained, which fields are read off each result, and
   which headers are set.
2. Compare that against the check named for that consumer. Confirm the loop
   style still matches, since `for await` and `next()` fail differently, and
   confirm the fields the check asserts are still the fields the consumer
   reads.
3. Check the version of the client the consumer depends on, and whether it is
   an exact pin or a range. A consumer pinned to an old version is not
   protected by anything here until it upgrades.
4. Add a check for any call pattern that is not covered yet. Reproduce what the
   consumer does rather than a tidied version of it, including the parts that
   look like mistakes, because those are what break.
5. Update the covered list and the consumer descriptions above so they still
   describe what the harness does.

Record anything you find that cannot become a check, the way the `readonly`
mismatch is recorded above. A known gap that is written down is worth more than
one that is rediscovered later.

## Reading a failure

A check that goes from pass to fail is a break for downstream consumers.

A check that still passes while its reported detail changes is a behavior
change that needs a release note. Two to watch, both reported rather than
asserted because they are deployment dependent or record a known bug:

* the `done` and `nextUri` sequence, because consumers have written
  workarounds against its current shape
* the `undrained=` value on the `SET TIME ZONE` check, which is the known bug
  described below. If it ever reports the zone that was set, the bug is fixed
  and that is a release note.

## Known bug: session statements on an un-drained iterator

Session state is only picked up from response headers as pages are read. A
statement submitted with `query` and then discarded, without its iterator ever
being advanced, is executed but its setting is never applied, because the
setting arrives on a page the client never fetches. Measured against Trino 479:

| Pattern | `select current_timezone()` |
|---|---|
| `SET TIME ZONE` submitted, iterator discarded | `UTC`, silently unchanged |
| `SET TIME ZONE` drained to completion | the zone that was set |
| `SET SESSION` drained to completion | applied, as a control |

Lightdash sets the time zone the first way, in `streamQuery`:

```ts
await session.query(`SET TIME ZONE '${options.timezone}'`);
```

so its timezone option currently has no effect through this client. Nothing in
the client throws or warns, and the query that follows returns correct rows in
the wrong zone, which is why this needs a check rather than a bug report alone.

Fixing it means either applying session headers from the initial response or
draining such statements internally, both of which change behavior consumers
may already work around. That makes it a major-release change rather than a
patch. Until then the check asserts only the draining case and reports the
other, so the fix will show up as a changed detail.

# Downstream compatibility tests

These checks run against the **packed tarball**, not against `src`. They
install the client the way a consumer installs it from npm, so they cover the
build output, the generated declaration file, and the package manifest, none of
which the integration tests in `tests/it` exercise.

## What they cover

The checks reproduce the call patterns of the largest consumers of this client
rather than the patterns of its own tests. Lightdash drives it through a manual
`next()` loop in `packages/warehouses`, Malloy drains it with `for await` in
`packages/malloy-db-trino`, and Beekeeper Studio embeds it in `apps/studio`.
Between them they depend on:

* `Trino.create` with `ConnectionOptions` spread from a partial config
* `BasicAuth`
* `Iterator<QueryResult>`, drained both with `for await` and with `next()`
* the observable `done` and `nextUri` sequence, including the terminal result
  arriving twice
* `extraHeaders` on the query object, used to send client tags
* column metadata through `columns[].typeSignature.rawType`
* errors read off `queryResult.error` rather than caught as a thrown exception
* `queryInfo` and `cancel`, where the cancel issues a `DELETE` that returns an
  empty body
* `SET SESSION` and `RESET SESSION` replaying through the response headers

The type check is as important as the run. `tsconfig.json` sets
`skipLibCheck: false` deliberately, so `dist/index.d.ts` is checked the way a
consumer's build checks it.

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

## Reading a failure

A check that goes from pass to fail is a break for downstream consumers.

A check that still passes while its reported detail changes is a behavior
change that needs a release note. The `done` and `nextUri` sequence is the one
to watch, because consumers have written workarounds against its current shape.

# trino-js-client

A [Trino](https://trino.io) client for [Node.js](https://nodejs.org/).

Join us on [Trino Slack](https://trino.io/slack) in
[#core-dev](https://trinodb.slack.com/archives/C07ABNN828M) to discuss and help
this project.

[![@latest](https://img.shields.io/npm/v/@trinodb/trino-js-client.svg)](https://www.npmjs.com/package/@trinodb/trino-js-client)
![it-tests](https://github.com/trinodb/trino-js-client/actions/workflows/it-tests.yml/badge.svg)
![license](https://img.shields.io/github/license/trinodb/trino-js-client)

## Features

- Connections over HTTP or HTTPS
- Supports HTTP Basic Authentication
- Per-query user information for access control

## Requirements

- Node 12 or newer.
- Trino 0.16x or newer.

## Install

`npm install @trinodb/trino-js-client` or `yarn add @trinodb/trino-js-client`

Versions up to and including 0.2.9 were published as `trino-client`, without a
scope. The scoped name starts at 0.3.0. Update the dependency name to keep
receiving new releases.

## Usage

For additional info on all available methods and types [have a look at the
`API` documentation](https://trinodb.github.io/trino-js-client/).

### Create a Trino client

```typescript
const trino: Trino = Trino.create({
  server: 'http://localhost:8080',
  catalog: 'tpcds',
  schema: 'sf100000',
  auth: new BasicAuth('test'),
});
```

### Submit a query

```typescript
const iter: Iterator<QueryResult> = await trino.query(
  'select * from customer limit 100'
);
```

### Iterate through the query results

```typescript
for await (const queryResult of iter) {
  console.log(queryResult.data);
}
```

### Alternative: map and aggregate the data

```typescript
const data: QueryData[] = await iter
  .map(r => r.data ?? [])
  .fold<QueryData[]>([], (row, acc) => [...acc, ...row]);
```

## Examples

More usage examples can be found in the
[integration tests](https://github.com/trinodb/trino-js-client/blob/main/tests/it/client.spec.ts).

## Build

Use the following commands to build the project locally with your modifications,
and in preparation to contribute a pull request.

Requirements:

* yarn

Install dependencies:

```shell
yarn install --frozen-lockfile
```

Lint the source code:

```shell
yarn test:lint
```

Build:

```shell
yarn build
```

A successful build run does not produce any message on the terminal.

## Integration test

Integration tests run against a Trino server running on your workstation.

Requirements:

* [kind](https://kind.sigs.k8s.io/ )
* [kubectl](https://kubernetes.io/docs/reference/kubectl/)

Create a cluster:

```shell
kind create cluster
```

Deploy Trino:

```shell
kubectl apply -f tests/it/trino.yml
```

Wait for pods to be ready:

```shell
kubectl wait --for=condition=ready pods -n trino-system --all --timeout=120s
```

Ensure Trino is running and available on port `8080`. Run the following 
command in a separate terminal:

```shell
kubectl -n trino-system port-forward svc/trino 8080:8080
```

Run tests:

```shell
yarn test:it --testTimeout=60000
```

Output should look similar to the following:

```text
 PASS  tests/it/client.spec.ts
  trino
    ✓ exhaust query results (1567 ms)
    ✓ close running query (200 ms)
    ✓ cancel running query (17 ms)
    ✓ get query info (1 ms)
    ✓ client extra header propagation
    ✓ query request header propagation (88 ms)
    ✓ QueryResult has error info
    ✓ QueryInfo has failure info (1 ms)
    ✓ prepare statement (98 ms)
    ✓ multiple prepare statement (432 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        3.457 s
Ran all test suites matching /tests\/it/i.
```

Remove the cluster:

```shell
kind delete cluster
```

## Contributing

Follow the [Trino contribution guidelines](https://trino.io/development/process)
and contact us on Slack and GitHub.

Copyright 
[Trino JS Client contributors](https://github.com/trinodb/trino-js-client/graphs/contributors) 2022-present

## Releasing

Releases are fully automated with GitHub Actions. A release needs nothing
beyond a merged pull request that updates the version.

1. Update the `version` field in `package.json` to the version you are about to
   release. Nothing else needs to change, since the lockfile records the
   workspace as `0.0.0-use.local` rather than the released version.
2. Commit the change on a branch, with `Release trino-js-client <version>` as
   the commit message, and open a pull request.
3. Merge the pull request once it is approved and the checks pass.

Merging runs the `release` workflow, which compares the version in
`package.json` against the preceding commit. When the version changed, the
workflow publishes the package to npm and then creates a GitHub release, tagged
with the version prefixed with `v`, and with generated release notes. A merge
that leaves the version untouched publishes nothing.

Watch the run to confirm that it succeeds, and check that the new version
appears on
[npm](https://www.npmjs.com/package/@trinodb/trino-js-client).

Publishing uses
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with
OpenID Connect, so no npm token is stored in this repository. npm verifies the
identity of the workflow directly and attaches a provenance attestation to
every published version. The trusted publisher is configured in the package
settings on npmjs.com and must match this repository and the `release.yml`
workflow file name. Renaming that file breaks publishing until the
configuration is updated to match.

Publishing a package under a name that does not exist on npm yet is the one
case this does not cover, because trusted publishing attaches its configuration
to an existing package. The first version under a new name has to be published
by a maintainer with access to the `@trinodb` scope, with
`yarn npm publish --no-provenance`, since provenance is only available from a
supported continuous integration environment.

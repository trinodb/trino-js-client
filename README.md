# trino-js-client

A [Trino](https://trino.io) client for [Node.js](https://nodejs.org/).

[![@latest](https://img.shields.io/npm/v/trino-client.svg)](https://www.npmjs.com/package/trino-client)
![it-tests](https://github.com/regadas/trino-js-client/actions/workflows/it-tests.yml/badge.svg)
![license](https://img.shields.io/github/license/regadas/trino-js-client)

## Features

- Connections over HTTP or HTTPS
- Supports HTTP Basic Authentication
- Per-query user information for access control

## Requirements

- Node 12 or newer.
- Trino 0.16x or newer.

## Install

`npm install trino-client` or `yarn add trino-client`

## Usage

For additional info on all available methods and types have a look at the `API` docs [here](https://regadas.dev/trino-js-client).

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

More usage [examples](https://github.com/regadas/trino-js-client/blob/main/tests/it/client.spec.ts) can be found in the [integration tests](https://github.com/regadas/trino-js-client/blob/main/tests/it/client.spec.ts).

Filipe Regadas (regadas) 2022

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

```typescript
const trino = Trino.create({
  server: 'http://localhost:8080'
  catalog: 'tpcds',
  schema: 'sf100000',
  auth: new BasicAuth('test'),
});

const iter = await trino.query('select * from customer limit 100');
const data = await iter
  .map(r => r.data ?? [])
  .fold<QueryData[]>([], (row, acc) => [...acc, ...row]);
```

More usage [examples](https://github.com/regadas/trino-js-client/blob/main/tests/it/client.spec.ts) can be found in the [integration tests](https://github.com/regadas/trino-js-client/blob/main/tests/it/client.spec.ts).

Filipe Regadas (regadas) 2022

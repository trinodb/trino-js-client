import {BasicAuth, QueryData, QueryResult, Iterator, Trino} from '../../src';

const allCustomerQuery = 'select * from customer';
const limit = 1;
const singleCustomerQuery = `select * from customer limit ${limit}`;
const useSchemaQuery = 'use tpcds.sf100000';
const prepareListCustomerQuery =
  'prepare list_customers from select * from customer limit ?';
const listCustomersQuery = `execute list_customers using ${limit}`;
const prepareListSalesQuery =
  'prepare list_sales from select * from web_sales limit ?';
const listSalesQuery = `execute list_sales using ${limit}`;

describe('trino', () => {
  test.concurrent('exhaust query results', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });

    const iter = await trino.query(singleCustomerQuery);
    const data = await iter
      .map(r => r.data ?? [])
      .fold<QueryData[]>([], (row, acc) => [...acc, ...row]);

    expect(data).toHaveLength(limit);
  });

  test.concurrent('close running query', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });
    const query = await trino.query(allCustomerQuery);
    const qr = await query.next();
    await trino.cancel(qr.value.id);

    const info = await trino.queryInfo(qr.value.id);

    expect(info.state).toBe('FAILED');
  });

  test.concurrent('cancel running query', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });
    const query = await trino.query(allCustomerQuery);
    const qr = await query.next();

    await trino.cancel(qr.value.id);
    const info = await trino.queryInfo(qr.value.id);

    expect(info.state).toBe('FAILED');
  });

  test.concurrent('get query info', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });
    const query = await trino.query(singleCustomerQuery);
    const qr = await query.next();
    await trino.cancel(qr.value.id);

    const info = await trino.queryInfo(qr.value.id);
    expect(info.query).toBe(singleCustomerQuery);
  });

  test.concurrent('query request header propagation', async () => {
    const trino = Trino.create({catalog: 'tpcds', auth: new BasicAuth('test')});
    const query = await trino.query(useSchemaQuery);
    await query.next();

    const sqr = await trino.query(singleCustomerQuery);
    const qr = await sqr.next();
    await trino.cancel(qr.value.id);

    const info = await trino.queryInfo(qr.value.id);
    expect(info.query).toBe(singleCustomerQuery);
  });

  test.concurrent('QueryResult has error info', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });
    const sqr = await trino.query('select * from foobar where id = -1');
    const qr = await sqr.next();
    expect(qr.value.error).toBeDefined();
    expect(qr.value.error?.message).toBe(
      "line 1:15: Table 'tpcds.sf100000.foobar' does not exist"
    );

    await trino.cancel(qr.value.id);
  });

  test.concurrent('QueryInfo has failure info', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });

    const sqr = await trino.query('select * from foobar where id = -1');
    const qr = await sqr.next();
    await trino.cancel(qr.value.id);

    const info = await trino.queryInfo(qr.value.id);
    expect(info.state).toBe('FAILED');
    expect(info.failureInfo?.message).toBe(
      "line 1:15: Table 'tpcds.sf100000.foobar' does not exist"
    );
  });

  test.concurrent('prepare statement', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });

    await trino.query(prepareListCustomerQuery).then(qr => qr.next());

    const iter = await trino.query(listCustomersQuery);
    const data = await iter.fold<QueryData[]>([], (row, acc) => [
      ...acc,
      ...(row.data ?? []),
    ]);
    expect(data).toHaveLength(limit);
  });

  test.concurrent('multiple prepare statement', async () => {
    const trino = Trino.create({
      catalog: 'tpcds',
      schema: 'sf100000',
      auth: new BasicAuth('test'),
    });

    await trino.query(prepareListCustomerQuery).then(qr => qr.next());
    await trino.query(prepareListSalesQuery).then(qr => qr.next());

    const customersIter = await trino.query(listCustomersQuery);
    const customers = await customersIter.fold<QueryData[]>([], (row, acc) => [
      ...acc,
      ...(row.data ?? []),
    ]);
    expect(customers).toHaveLength(limit);

    const salesIter = await trino.query(listSalesQuery);
    const sales = await salesIter.fold<QueryData[]>([], (row, acc) => [
      ...acc,
      ...(row.data ?? []),
    ]);
    expect(sales).toHaveLength(limit);
  });
});

import {Trino} from '../../src';

describe('trino', () => {
  const trino = new Trino({});
  const queryAll = 'select * from tpcds.sf100000.customer';
  const limit = 1;
  const query = `select * from tpcds.sf100000.customer limit ${limit}`;

  test('exhaust query results', async () => {
    expect.assertions(1);

    let stmt = await trino.query(query);
    let data: any[] = [];

    try {
      while (stmt.hasNext()) {
        stmt = await stmt.next();
        data = data.concat(stmt.data);
      }
    } finally {
      await stmt.close();
    }

    expect(data).toHaveLength(limit);
  });

  test('close running query', async () => {
    expect.assertions(1);

    let stmt = await trino.query(queryAll);
    stmt = await stmt.next();
    stmt = await stmt.close();

    const info = await trino.queryInfo(stmt.queryId);

    expect(info.state).toBe('FAILED');
  });

  test('cancel running query', async () => {
    let stmt = await trino.query(queryAll);
    stmt = await stmt.next();

    stmt = await trino.cancel(stmt.queryId);
    const info = await trino.queryInfo(stmt.queryId);

    expect(info.state).toBe('FAILED');
  });

  test('get query info', async () => {
    let stmt = await trino.query(query);
    stmt = await stmt.next();

    const info = await trino.queryInfo(stmt.queryId);
    expect(info.state).toBe('FINISHED');

    stmt = await stmt.close();
  });
});

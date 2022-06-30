import axios, {AxiosInstance, AxiosRequestConfig} from 'axios';

const DEFAULT_SERVER = 'http://localhost:8080';

// Trino headers
const TRINO_HEADER_PREFIX = 'X-Trino-';
const TRINO_PREPARED_STATEMENT_HEADER =
  TRINO_HEADER_PREFIX + 'Prepared-Statement';
const TRINO_USER_HEADER = TRINO_HEADER_PREFIX + 'User';
const TRINO_SOURCE_HEADER = TRINO_HEADER_PREFIX + 'Source';
const TRINO_CATALOG_HEADER = TRINO_HEADER_PREFIX + 'Catalog';
const TRINO_SCHEMA_HEADER = TRINO_HEADER_PREFIX + 'Schema';
const TRINO_SESSION_HEADER = TRINO_HEADER_PREFIX + 'Session';
const TRINO_SET_CATALOG_HEADER = TRINO_HEADER_PREFIX + 'Set-Catalog';
const TRINO_SET_SCHEMA_HEADER = TRINO_HEADER_PREFIX + 'Set-Schema';
const TRINO_SET_PATH_HEADER = TRINO_HEADER_PREFIX + 'Set-Path';
const TRINO_SET_SESSION_HEADER = TRINO_HEADER_PREFIX + 'Set-Session';
const TRINO_CLEAR_SESSION_HEADER = TRINO_HEADER_PREFIX + 'Clear-Session';
const TRINO_SET_ROLE_HEADER = TRINO_HEADER_PREFIX + 'Set-Role';
const TRINO_EXTRA_CREDENTIAL_HEADER = TRINO_HEADER_PREFIX + 'Extra-Credential';

export type ConnectionOptions = {
  readonly server?: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly user?: string;
  readonly password?: string;
};

export type QueryStage = {
  stageId: string;
  state: string;
  done: boolean;
  nodes: number;
  totalSplits: number;
  queuedSplits: number;
  runningSplits: number;
  completedSplits: number;
  cpuTimeMillis: number;
  wallTimeMillis: number;
  processedRows: number;
  processedBytes: number;
  physicalInputBytes: number;
  failedTasks: number;
  coordinatorOnly: boolean;
  subStages: QueryStage[];
};

export type QueryStats = {
  state: string;
  queued: boolean;
  scheduled: boolean;
  nodes: number;
  totalSplits: number;
  queuedSplits: number;
  runningSplits: number;
  completedSplits: number;
  cpuTimeMillis: number;
  wallTimeMillis: number;
  queuedTimeMillis: number;
  elapsedTimeMillis: number;
  processedRows: number;
  processedBytes: number;
  physicalInputBytes: number;
  peakMemoryBytes: number;
  spilledBytes: number;
  rootStage: QueryStage;
  progressPercentage: number;
};

export type QueryResult = {
  id: string;
  infoUri?: string;
  nextUri?: string;
  columns?: {name: string; type: string}[];
  data?: any[][];
  stats?: QueryStats;
  warnings?: string[];
};

export type QueryInfo = {
  queryId: string;
  state: string;
  query: string,
};

class Client {
  private readonly underlying: AxiosInstance;

  constructor(private readonly options: ConnectionOptions) {
    this.underlying = axios.create({
      baseURL: options.server ?? DEFAULT_SERVER,
      headers: {
        [TRINO_USER_HEADER]: options.user ?? process.env.USER ?? '',
        [TRINO_SOURCE_HEADER]: 'trino-js-client',
        [TRINO_CATALOG_HEADER]: options.catalog ?? '',
        [TRINO_SCHEMA_HEADER]: options.schema ?? '',
      },
    });
  }

  async request<T>(cfg: AxiosRequestConfig<any>): Promise<T> {
    const request = this.underlying.request(cfg);
    return request.then(response => response.data);
  }

  async query(query: string): Promise<QueryResult> {
    return this.request({method: 'POST', url: '/v1/statement', data: query});
  }

  async queryInfo(queryId: string): Promise<QueryInfo> {
    return this.request({url: `/v1/query/${queryId}`, method: 'GET'});
  }

  async cancel(queryId: string): Promise<QueryResult> {
    return this.request({url: `/v1/query/${queryId}`, method: 'DELETE'}).then(
      _ => <QueryResult>{id: queryId}
    );
  }
}

class Result {
  constructor(
    private readonly client: Client,
    private queryResult: QueryResult
  ) {}

  hasNext(): boolean {
    return !!this.queryResult.nextUri;
  }

  async next(): Promise<QueryResult> {
    if (!this.queryResult.nextUri) {
      return this.queryResult;
    }

    this.queryResult = await this.client.request<QueryResult>({
      url: this.queryResult.nextUri,
    });

    const data = this.queryResult.data ?? [];
    if (data.length === 0) {
      if (this.queryResult.nextUri) {
        return this.next();
      }
    }

    return this.queryResult;
  }

  async close(): Promise<QueryResult> {
    this.queryResult = await this.client.cancel(this.queryResult.id);
    return this.queryResult;
  }

  async forAll(fn: (row: QueryResult) => void): Promise<void> {
    try {
      while (this.hasNext()) {
        await this.next();
        fn(this.queryResult);
      }
    } finally {
      await this.close();
    }
  }

  async map<T>(fn: (row: QueryResult) => T): Promise<T[]> {
    const result: T[] = [];
    await this.forAll(row => result.push(fn(row)));
    return result;
  }

  async fold<T>(acc: T, fn: (row: QueryResult, acc: T) => T): Promise<T> {
    await this.forAll(row => (acc = fn(row, acc)));
    return acc;
  }
}

export class Trino {
  private readonly client: Client;

  constructor(private readonly options: ConnectionOptions) {
    this.client = new Client(options);
  }

  async query(query: string): Promise<Result> {
    return this.client.query(query).then(resp => new Result(this.client, resp));
  }

  async queryInfo(query: string): Promise<QueryInfo> {
    return this.client.queryInfo(query);
  }

  async cancel(queryId: string): Promise<Result> {
    return this.client
      .cancel(queryId)
      .then(resp => new Result(this.client, resp));
  }
}

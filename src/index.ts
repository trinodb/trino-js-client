import axios, {AxiosRequestConfig, RawAxiosRequestHeaders} from 'axios';
import * as https from 'https';
import * as tls from 'tls';

const DEFAULT_SERVER = 'http://localhost:8080';
const DEFAULT_SOURCE = 'trino-js-client';
const DEFAULT_USER = process.env.USER;

// Trino headers
const TRINO_HEADER_PREFIX = 'X-Trino-';
const TRINO_PREPARED_STATEMENT_HEADER =
  TRINO_HEADER_PREFIX + 'Prepared-Statement';
const TRINO_ADDED_PREPARE_HEADER = TRINO_HEADER_PREFIX + 'Added-Prepare';
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

export type AuthType = string;

export interface Auth {
  readonly type: AuthType;
}

export class BasicAuth implements Auth {
  readonly type: AuthType = 'basic';
  constructor(readonly username: string, readonly password?: string) {}
}

export type Session = {[key: string]: string};

export type ExtraCredential = {[key: string]: string};

const encodeAsString = (obj: {[key: string]: string}) => {
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
};

export type RequestHeaders = {
  [key: string]: string;
}

export type SecureContextOptions = tls.SecureContextOptions & {
  readonly rejectUnauthorized?: boolean;
};

export type ConnectionOptions = {
  readonly server?: string;
  readonly source?: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly auth?: Auth;
  readonly session?: Session;
  readonly extraCredential?: ExtraCredential;
  readonly ssl?: SecureContextOptions;
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

export type Columns = {name: string; type: string}[];

export type QueryData = any[];

export type QueryFailureInfo = {
  type: string;
  message: string;
  suppressed: string[];
  stack: string[];
};

export type QueryError = {
  message: string;
  errorCode: number;
  errorName: string;
  errorType: string;
  failureInfo: QueryFailureInfo;
};

export type QueryResult = {
  id: string;
  infoUri?: string;
  nextUri?: string;
  columns?: Columns;
  data?: QueryData[];
  stats?: QueryStats;
  warnings?: string[];
  error?: QueryError;
};

export type QueryInfo = {
  queryId: string;
  state: string;
  query: string;
  failureInfo?: QueryFailureInfo;
};

export type Query = {
  query: string;
  catalog?: string;
  schema?: string;
  user?: string;
  session?: Session;
  extraCredential?: ExtraCredential;
  extraHeaders?: RequestHeaders;
};

/**
 * It takes a Headers object and returns a new object with the same keys, but only the values that are
 * truthy
 * @param {RawAxiosRequestHeaders} headers - RawAxiosRequestHeaders - The headers object to be sanitized.
 * @returns An object with the key-value pairs of the headers object, but only if the value is truthy.
 */
const cleanHeaders = (headers: RawAxiosRequestHeaders) => {
  const sanitizedHeaders: RawAxiosRequestHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      sanitizedHeaders[key] = value;
    }
  }
  return sanitizedHeaders;
};

/* It's a wrapper around the Axios library that adds some Trino specific headers to the requests */
class Client {
  private constructor(
    private readonly clientConfig: AxiosRequestConfig,
    private readonly options: ConnectionOptions
  ) {}

  static create(options: ConnectionOptions): Client {
    const agent = new https.Agent({...(options.ssl ?? {}), keepAlive: true});

    const clientConfig: AxiosRequestConfig = {
      baseURL: options.server ?? DEFAULT_SERVER,
      httpsAgent: agent,
    };

    const headers: RawAxiosRequestHeaders = {
      [TRINO_USER_HEADER]: DEFAULT_USER,
      [TRINO_SOURCE_HEADER]: options.source ?? DEFAULT_SOURCE,
      [TRINO_CATALOG_HEADER]: options.catalog,
      [TRINO_SCHEMA_HEADER]: options.schema,
      [TRINO_SESSION_HEADER]: encodeAsString(options.session ?? {}),
      [TRINO_EXTRA_CREDENTIAL_HEADER]: encodeAsString(
        options.extraCredential ?? {}
      ),
    };

    if (options.auth && options.auth.type === 'basic') {
      const basic: BasicAuth = <BasicAuth>options.auth;
      clientConfig.auth = {
        username: basic.username,
        password: basic.password ?? '',
      };

      headers[TRINO_USER_HEADER] = basic.username;
    }

    clientConfig.headers = cleanHeaders(headers);

    return new Client(clientConfig, options);
  }

  /**
   * Generic method to send a request to the server.
   * @param cfg - AxiosRequestConfig<any>
   * @returns The response data.
   */
  async request<T>(cfg: AxiosRequestConfig<unknown>): Promise<T> {
    return axios
      .create(this.clientConfig)
      .request(cfg)
      .then(response => {
        const reqHeaders: RawAxiosRequestHeaders =
          this.clientConfig.headers ?? {};
        const respHeaders = response.headers;
        reqHeaders[TRINO_CATALOG_HEADER] =
          respHeaders[TRINO_SET_CATALOG_HEADER.toLowerCase()] ??
          reqHeaders[TRINO_CATALOG_HEADER] ??
          this.options.catalog;
        reqHeaders[TRINO_SCHEMA_HEADER] =
          respHeaders[TRINO_SET_SCHEMA_HEADER.toLowerCase()] ??
          reqHeaders[TRINO_SCHEMA_HEADER] ??
          this.options.schema;
        reqHeaders[TRINO_SESSION_HEADER] =
          respHeaders[TRINO_SET_SESSION_HEADER.toLowerCase()] ??
          reqHeaders[TRINO_SESSION_HEADER] ??
          encodeAsString(this.options.session ?? {});

        if (TRINO_CLEAR_SESSION_HEADER.toLowerCase() in respHeaders) {
          reqHeaders[TRINO_SESSION_HEADER] = undefined;
        }

        if (TRINO_ADDED_PREPARE_HEADER.toLowerCase() in respHeaders) {
          const prep = reqHeaders[TRINO_PREPARED_STATEMENT_HEADER];

          reqHeaders[TRINO_PREPARED_STATEMENT_HEADER] =
            (prep ? prep + ',' : '') +
            respHeaders[TRINO_ADDED_PREPARE_HEADER.toLowerCase()];
        }

        this.clientConfig.headers = cleanHeaders(reqHeaders);

        return response.data;
      });
  }

  /**
   * It takes a query object and returns a promise that resolves to a query result object
   * @param {Query | string} query - The query to execute.
   * @returns A promise that resolves to a QueryResult object.
   */
  async query(query: Query | string): Promise<Iterator<QueryResult>> {
    const req = typeof query === 'string' ? {query} : query;
    const headers: RawAxiosRequestHeaders = {
      [TRINO_USER_HEADER]: req.user,
      [TRINO_CATALOG_HEADER]: req.catalog,
      [TRINO_SCHEMA_HEADER]: req.schema,
      [TRINO_SESSION_HEADER]: encodeAsString(req.session ?? {}),
      [TRINO_EXTRA_CREDENTIAL_HEADER]: encodeAsString(
        req.extraCredential ?? {}
      ),
    ...(req.extraHeaders ?? {})
    };
    const requestConfig = {
      method: 'POST',
      url: '/v1/statement',
      data: req.query,
      headers: cleanHeaders(headers),
    };
    return this.request<QueryResult>(requestConfig).then(
      result => new Iterator(new QueryIterator(this, result))
    );
  }

  /**
   * It returns the query info for a given queryId.
   * @param {string} queryId - The query ID of the query you want to get information about.
   * @returns The query info
   */
  async queryInfo(queryId: string): Promise<QueryInfo> {
    return this.request({url: `/v1/query/${queryId}`, method: 'GET'});
  }

  /**
   * It cancels a query.
   * @param {string} queryId - The queryId of the query to cancel.
   * @returns The result of the query.
   */
  async cancel(queryId: string): Promise<QueryResult> {
    return this.request({url: `/v1/query/${queryId}`, method: 'DELETE'}).then(
      _ => <QueryResult>{id: queryId}
    );
  }
}

export class Iterator<T> implements AsyncIterableIterator<T> {
  constructor(private readonly iter: AsyncIterableIterator<T>) {}

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    return this.iter.next();
  }

  /**
   * Calls a defined callback function on each QueryResult, and returns an array that contains the results.
   * @param fn A function that accepts a QueryResult. map calls the fn function one time for each QueryResult.
   */
  map<B>(fn: (t: T) => B): Iterator<B> {
    const that: AsyncIterableIterator<T> = this.iter;
    const asyncIterableIterator: AsyncIterableIterator<B> = {
      [Symbol.asyncIterator]: () => asyncIterableIterator,
      async next() {
        return that.next().then(result => {
          return <IteratorResult<B>>{
            value: fn(result.value),
            done: result.done,
          };
        });
      },
    };
    return new Iterator(asyncIterableIterator);
  }

  /**
   * Performs the specified action for each element.
   * @param fn A function that accepts a QueryResult. forEach calls the fn function one time for each QueryResult.
   */
  async forEach(fn: (value: T) => void): Promise<void> {
    for await (const value of this) {
      fn(value);
    }
  }

  /**
   * Calls a defined callback function on each QueryResult. The return value of the callback function is the accumulated
   * result, and is provided as an argument in the next call to the callback function.
   * @param acc The initial value of the accumulator.
   * @param fn A function that accepts a QueryResult and accumulator, and returns an accumulator.
   */
  async fold<B>(acc: B, fn: (value: T, acc: B) => B): Promise<B> {
    await this.forEach(value => (acc = fn(value, acc)));
    return acc;
  }
}

/**
 * Iterator for the query result data.
 */
export class QueryIterator implements AsyncIterableIterator<QueryResult> {
  constructor(
    private readonly client: Client,
    private queryResult: QueryResult
  ) {}

  [Symbol.asyncIterator](): AsyncIterableIterator<QueryResult> {
    return this;
  }

  /**
   * It returns true if the queryResult object has a nextUri property, and false otherwise
   * @returns A boolean value.
   */
  hasNext(): boolean {
    return !!this.queryResult.nextUri;
  }

  /**
   * Retrieves the next QueryResult available. If there's no nextUri then there are no more
   * results and the query reached a completion state, successful or failure.
   * @returns The next set of results.
   */
  async next(): Promise<IteratorResult<QueryResult>> {
    if (!this.hasNext()) {
      return Promise.resolve({value: this.queryResult, done: true});
    }

    this.queryResult = await this.client.request<QueryResult>({
      url: this.queryResult.nextUri,
    });

    const data = this.queryResult.data ?? [];
    if (data.length === 0) {
      if (this.hasNext()) {
        return this.next();
      }
    }

    return Promise.resolve({value: this.queryResult, done: false});
  }
}

/**
 * Trino is a client for the Trino REST API.
 */
export class Trino {
  private constructor(private readonly client: Client) {}

  static create(options: ConnectionOptions): Trino {
    return new Trino(Client.create(options));
  }

  /**
   * Submittes a query for execution and returns a QueryIterator object that can be used to iterate over the query results.
   * @param query - The query to execute.
   * @returns A QueryIterator object.
   */
  async query(query: Query | string): Promise<Iterator<QueryResult>> {
    return this.client.query(query);
  }

  /**
   * Retrieves the query info for a given queryId.
   * @param queryId - The query to execute.
   * @returns The query info
   */
  async queryInfo(queryId: string): Promise<QueryInfo> {
    return this.client.queryInfo(queryId);
  }

  /**
   * It cancels a query.
   * @param {string} queryId - The queryId of the query to cancel.
   * @returns The result of the query.
   */
  async cancel(queryId: string): Promise<QueryResult> {
    return this.client.cancel(queryId);
  }
}

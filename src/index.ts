import axios, {AxiosRequestConfig} from 'axios';

const DEFAULT_SERVER = 'http://localhost:8080';
const DEFAULT_SOURCE = 'trino-js-client';
const DEFAULT_USER = process.env.USER;

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

export type ConnectionOptions = {
  readonly server?: string;
  readonly source?: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly auth?: Auth;
  readonly session?: Session;
  readonly extraCredential?: ExtraCredential;
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
};

type Headers = {
  [key: string]: string | number | boolean | undefined;
};

/**
 * It takes a Headers object and returns a new object with the same keys, but only the values that are
 * truthy
 * @param {Headers} headers - Headers - The headers object to be sanitized.
 * @returns An object with the key-value pairs of the headers object, but only if the value is truthy.
 */
const cleanHeaders = (headers: Headers) => {
  const sanitizedHeaders: {[key: string]: string | number | boolean} = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      sanitizedHeaders[key] = value;
    }
  }
  return sanitizedHeaders;
};

/* It's a wrapper around the Axios library that adds some Trino specific headers to the requests */
class Client {
  private readonly clientConfig: AxiosRequestConfig;

  constructor(private readonly options: ConnectionOptions) {
    this.clientConfig = {baseURL: options.server ?? DEFAULT_SERVER};

    const headers: Headers = {
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
      this.clientConfig.auth = {
        username: basic.username,
        password: basic.password ?? '',
      };

      headers[TRINO_USER_HEADER] = basic.username;
    }

    this.clientConfig.headers = cleanHeaders(headers);
  }

  /**
   * Generic method to send a request to the server.
   * @param cfg - AxiosRequestConfig<any>
   * @returns The response data.
   */
  async request<T>(cfg: AxiosRequestConfig<any>): Promise<T> {
    return axios
      .create(this.clientConfig)
      .request(cfg)
      .then(response => {
        const reqHeaders: Headers = this.clientConfig.headers ?? {};
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

        this.clientConfig.headers = cleanHeaders(reqHeaders);

        return response.data;
      });
  }

  /**
   * It takes a query object and returns a promise that resolves to a query result object
   * @param {Query | string} query - The query to execute.
   * @returns A promise that resolves to a QueryResult object.
   */
  async query(query: Query | string): Promise<QueryResult> {
    const req = typeof query === 'string' ? {query} : query;
    const headers: Headers = {
      [TRINO_USER_HEADER]: req.user,
      [TRINO_CATALOG_HEADER]: req.catalog,
      [TRINO_SCHEMA_HEADER]: req.schema,
      [TRINO_SESSION_HEADER]: encodeAsString(req.session ?? {}),
      [TRINO_EXTRA_CREDENTIAL_HEADER]: encodeAsString(
        req.extraCredential ?? {}
      ),
    };

    return this.request({
      method: 'POST',
      url: '/v1/statement',
      data: req.query,
      headers: cleanHeaders(headers),
    });
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

/**
 * Iterator for the query result data.
 */
export class QueryIterator {
  constructor(
    private readonly client: Client,
    private queryResult: QueryResult
  ) {}

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
  async next(): Promise<QueryResult> {
    if (!this.hasNext()) {
      return this.queryResult;
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

    return this.queryResult;
  }

  /**
   * Closes the iterator which in reallity cancels the running query.
   * @returns The query result with the id of the cancelled query.
   */
  async close(): Promise<QueryResult> {
    this.queryResult = await this.client.cancel(this.queryResult.id);
    return this.queryResult;
  }

  /**
   * Performs the specified action for each element.
   * @param fn A function that accepts a QueryResult. forEach calls the fn function one time for each QueryResult.
   */
  async forEach(fn: (queryResult: QueryResult) => void): Promise<void> {
    try {
      while (this.hasNext()) {
        await this.next();
        fn(this.queryResult);
      }
    } finally {
      await this.close();
    }
  }

  /**
   * Calls a defined callback function on each QueryResult, and returns an array that contains the results.
   * @param fn A function that accepts a QueryResult. map calls the fn function one time for each QueryResult.
   */
  async map<T>(fn: (queryResult: QueryResult) => T): Promise<T[]> {
    return this.fold(<T[]>[], (qr, acc) => {
      acc.push(fn(qr));
      return acc;
    });
  }

  /**
   * Calls a defined callback function on each QueryResult. The return value of the callback function is the accumulated
   * result, and is provided as an argument in the next call to the callback function.
   * @param acc The initial value of the accumulator.
   * @param fn A function that accepts a QueryResult and accumulator, and returns an accumulator.
   */
  async fold<T>(acc: T, fn: (row: QueryResult, acc: T) => T): Promise<T> {
    await this.forEach(row => (acc = fn(row, acc)));
    return acc;
  }
}

/**
 * Trino is a client for the Trino REST API.
 */
export class Trino {
  private readonly client: Client;

  constructor(options: ConnectionOptions) {
    this.client = new Client(options);
  }

  /**
   * Submittes a query for execution and returns a QueryIterator object that can be used to iterate over the query results.
   * @param query - The query to execute.
   * @returns A QueryIterator object.
   */
  async query(query: Query | string): Promise<QueryIterator> {
    return this.client
      .query(query)
      .then(resp => new QueryIterator(this.client, resp));
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

/**
 * index.ts
 * @description ライブラリの公開 API エントリーポイント
 *
 * このファイルのみを import することを推奨する。
 * 内部実装（HttpCore / ApiClient / LoggerFacade 等）は直接 import しない。
 */

// ============================================================================
// 型
// ============================================================================

export type { BaseClient, Plugin, ResponseHandler } from './ApiClient.js';
export type { Transport, FetchOptions, RawResponse, RequestOptions, FilePart, FormFields } from './httpTypes.js';
export { HttpError, RetryExhaustedError } from './httpTypes.js';
export type { Logger } from './LoggerFacade.js';

// ============================================================================
// ユーティリティ
// ============================================================================

export { LazyTemplate } from './LazyTemplate.js';
export type { FilterFn, FilterMap } from './LazyTemplate.js';
export { SlackFilters } from './SlackFilters.js';
export type { SlackFilterMap } from './SlackFilters.js';
export { deepFreeze } from './deepFreeze.js';

// ============================================================================
// クライアント
// ============================================================================

export { SalesforceApiClient } from './SalesforceApiClient.js';
export type { SalesforceClientOptions } from './SalesforceApiClient.js';

export { GBizInfoApiClient } from './GBizInfoApiClient.js';
export type { GBizInfoClientOptions } from './GBizInfoApiClient.js';

export { InvoiceApiClient } from './InvoiceApiClient.js';
export type {
  InvoiceClientOptions,
  InvoiceApiVersion,
  InvoiceResponseType,
} from './InvoiceApiClient.js';

export { SalesforceAuth } from './SalesforceAuth.js';
export type { JwtOptions, JwtDependencies, TokenResult, Signer } from './SalesforceAuth.js';

export { BacklogApiClient, BacklogApiError, BACKLOG_ERROR_CODE } from './BacklogApiClient.js';
export type { BacklogClientOptions, BacklogAuth } from './BacklogApiClient.js';

export { SlackApiClient, SlackWebhookClient, SlackApiError } from './SlackClient.js';
export type {
  SlackApiClientOptions,
  SlackWebhookOptions,
  SlackPayload,
  SlackWebhookInstance,
} from './SlackClient.js';

// ============================================================================
// プラグイン
// ============================================================================

export { SalesforceApiClientPlugins } from './plugins/salesforce.js';
export type {
  SoqlResult,
  IngestOperation, IngestState, QueryOperation, QueryState, ColumnDelimiter, LineEnding,
  CreateIngestJobOptions, IngestJobInfo, ListIngestJobsOptions, ListIngestJobsResponse,
  CreateQueryJobOptions, QueryJobInfo, ListQueryJobsOptions, ListQueryJobsResponse,
  GetResultsOptions, QueryResultsPage, GetResultsParallelOptions,
  WaitOptions, ValidationError, ValidationWarning, ValidationResult,
  BulkIngestPlugin, BulkQueryPlugin,
} from './plugins/salesforce.js';

export { SlackPlugins } from './plugins/slack.js';
export type { ChatOptions, SlackBlock } from './plugins/slack.js';

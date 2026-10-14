/**
 * index.ts
 *
 * @description ライブラリの公開 API エントリーポイント
 *
 * このファイルのみを import することを推奨する。
 * 内部実装（HttpCore / ApiClient / LoggerFacade 等）は直接 import しない。
 */

// ============================================================================
// 型
// ============================================================================

export type { BaseClient, Plugin, ResponseHandler } from './ApiClient.ts';
export type { Transport, FetchOptions, RawResponse, RequestOptions } from './httpTypes.ts';
export { HttpError, RetryExhaustedError } from './httpTypes.ts';
export type { Logger } from './LoggerFacade.ts';

// ============================================================================
// ユーティリティ
// ============================================================================

export { LazyTemplate } from './LazyTemplate.ts';
export type { FilterFn, FilterMap } from './LazyTemplate.ts';
export { SlackFilters } from './SlackFilters.ts';
export type { SlackFilterMap } from './SlackFilters.ts';
export { deepFreeze } from './deepFreeze.ts';

// ============================================================================
// クライアント
// ============================================================================

export { SalesforceApiClient } from './SalesforceApiClient.ts';
export type { SalesforceClientOptions } from './SalesforceApiClient.ts';

export { GBizInfoApiClient } from './GBizInfoApiClient.ts';
export type { GBizInfoClientOptions } from './GBizInfoApiClient.ts';

export { InvoiceApiClient } from './InvoiceApiClient.ts';
export type {
  InvoiceClientOptions,
  InvoiceApiVersion,
  InvoiceResponseType,
} from './InvoiceApiClient.ts';

export { SalesforceAuth } from './SalesforceAuth.ts';
export type { JwtOptions, JwtDependencies, TokenResult, Signer } from './SalesforceAuth.ts';

export { SlackApiClient, SlackWebhookClient, SlackApiError } from './SlackClient.ts';
export type {
  SlackApiClientOptions,
  SlackWebhookOptions,
  SlackPayload,
  SlackWebhookInstance,
} from './SlackClient.ts';

// ============================================================================
// プラグイン
// ============================================================================

export { SalesforceApiClientPlugins } from './plugins/salesforce.ts';
export type {
  SoqlResult,
  IngestOperation,
  IngestState,
  QueryOperation,
  QueryState,
  ColumnDelimiter,
  LineEnding,
  CreateIngestJobOptions,
  IngestJobInfo,
  ListIngestJobsOptions,
  ListIngestJobsResponse,
  CreateQueryJobOptions,
  QueryJobInfo,
  ListQueryJobsOptions,
  ListQueryJobsResponse,
  GetResultsOptions,
  QueryResultsPage,
  GetResultsParallelOptions,
  WaitOptions,
  ValidationError,
  ValidationWarning,
  ValidationResult,
  BulkIngestPlugin,
  BulkQueryPlugin,
} from './plugins/salesforce.ts';

export { SlackPlugins } from './plugins/slack.ts';
export type { ChatOptions, SlackBlock } from './plugins/slack.ts';

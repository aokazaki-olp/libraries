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
export type { Transport, FetchOptions, RawResponse, RequestOptions } from './httpTypes.js';
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

export { SalesforceAuth } from './SalesforceAuth.js';
export type { JwtOptions, JwtDependencies, TokenResult, Signer } from './SalesforceAuth.js';

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

export { SalesforcePlugins } from './plugins/salesforce.js';
export type { SoqlResult } from './plugins/salesforce.js';

export { SlackPlugins } from './plugins/slack.js';
export type { ChatOptions, SlackBlock } from './plugins/slack.js';

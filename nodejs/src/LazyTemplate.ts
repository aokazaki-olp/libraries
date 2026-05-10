/**
 * LazyTemplate.ts
 * @description ランタイム非依存の遅延評価テンプレートエンジン
 *
 * テンプレート構文:
 *   {{{expression}}}
 *   {{{key}}}
 *   {{{key | filter}}}
 *   {{{key | filter1 | filter2}}}
 *   {{{key || defaultValue}}}
 *   {{{key.property}}}
 *   {{{array[0]}}}
 *   {{{object["key"]}}}
 *
 * 使用例:
 *   const t = new LazyTemplate('Hello {{{name}}}!');
 *   t.evaluate({ name: 'World' }); // => "Hello World!"
 *
 *   // カスタムフィルター
 *   const t = new LazyTemplate('{{{price | jpy}}}', { jpy: v => `¥${v}` });
 *   t.evaluate({ price: 1000 }); // => "¥1000"
 *
 *   // 静的ワンショット
 *   LazyTemplate.evaluate('{{{name}}}', { name: 'World' }); // => "World"
 */

type FilterFn = (v: unknown) => unknown;
type FilterMap = Record<string, FilterFn>;

interface PlaceholderPart {
  type: 'placeholder';
  backslashes: string;
  expression: string;
}

interface TextPart {
  type: 'text';
  value: string;
}

type TemplatePart = TextPart | PlaceholderPart;

type CompiledEvaluator = (data: object) => unknown;

class LazyTemplate {
  /** プレースホルダーパターン: {{{expression}}} */
  static readonly PLACEHOLDER_PATTERN = /(\\*)\{\{\{([\s\S]*?)\}\}\}/;

  /** 演算子・トークンパターン */
  static readonly OPERATOR_OR_TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\|\||\||[\s\S]/;

  /** キーセグメントパターン */
  static readonly KEY_SEGMENT_PATTERN = /(?:^|\.)\s*([^\s.\[\]]+)|\[\s*(("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?(?:0|[1-9]\d*)(?:\.\d+)?)\s*)\]/;

  /** 数値リテラルパターン */
  static readonly NUMBER_LITERAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

  /** バックスラッシュ一時退避センチネル (PUA U+E000 で囲みテンプレート本文との衝突を回避) */
  static readonly BACKSLASH_SENTINEL = '__LT_BS__';

  /** プリミティブフィルター 18個 */
  static readonly PRIMITIVE_FILTERS = {
    trim: (v: unknown) => typeof v === 'string' ? v.trim() : v,
    trimStart: (v: unknown) => typeof v === 'string' ? v.trimStart() : v,
    trimEnd: (v: unknown) => typeof v === 'string' ? v.trimEnd() : v,
    upper: (v: unknown) => typeof v === 'string' ? v.toUpperCase() : v,
    lower: (v: unknown) => typeof v === 'string' ? v.toLowerCase() : v,
    round: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : v; },
    int: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : v; },
    float: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : v; },
    abs: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.abs(n) : v; },
    ceil: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.ceil(n) : v; },
    floor: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : v; },
    negate: (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? -n : v; },
    length: (v: unknown) => (typeof v === 'string' || Array.isArray(v)) ? v.length : 0,
    string: (v: unknown) => v == null ? '' : String(v),
    boolean: (v: unknown) => Boolean(v),
    default: (v: unknown) => v == null ? '' : v,
    json: (v: unknown) => {
      try {
        return JSON.stringify(v);
      } catch {
        return '{}';
      }
    },
    jsonPretty: (v: unknown) => {
      try {
        return JSON.stringify(v, null, 2);
      } catch {
        return '{}';
      }
    },
  } as const satisfies FilterMap;

  private readonly cache: Map<string, CompiledEvaluator>;
  private readonly parts: TemplatePart[];
  private readonly filters: FilterMap;

  /**
   * @param template - テンプレート文字列（`{{{expression}}}` 構文）
   * @param filters - カスタムフィルターマップ（PRIMITIVE_FILTERS と合成される）
   * @throws {TypeError} template が文字列でない場合
   */
  constructor(template: string, filters: FilterMap = {}) {
    if (typeof template !== 'string') {
      throw new TypeError('template には文字列を指定してください');
    }
    this.cache = new Map();
    this.parts = this.parseTemplate(template);
    this.filters = { ...LazyTemplate.PRIMITIVE_FILTERS, ...filters };
  }

  /**
   * フィルターを動的に登録する
   * @param name - フィルター名（空でない文字列）
   * @param fn - フィルター関数
   * @throws {TypeError} name が空でない文字列でない場合、または fn が関数でない場合
   */
  registerFilter(name: string, fn: FilterFn): void {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('name には空でない文字列を指定してください');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('fn には関数を指定してください');
    }
    this.filters[name] = fn;
  }

  private parseTemplate(template: string): TemplatePart[] {
    const parts: TemplatePart[] = [];
    let lastIndex = 0;

    for (const m of template.matchAll(new RegExp(LazyTemplate.PLACEHOLDER_PATTERN.source, 'g'))) {
      // matchAll の結果は index が必ず定義される（RegExp.exec の仕様）
      const index = m.index as number;
      if (index > lastIndex) {
        parts.push({ type: 'text', value: template.slice(lastIndex, m.index) });
      }
      parts.push({
        type: 'placeholder',
        backslashes: m[1],
        expression: m[2].trim(),
      });
      lastIndex = index + m[0].length;
    }

    if (lastIndex < template.length) {
      parts.push({ type: 'text', value: template.slice(lastIndex) });
    }

    return parts;
  }

  private static stripWhitespaceWithoutStringLiteral(expression: string): string {
    let stripped = '';
    let quoted = false;
    let quote = '';
    let wasSpace = false;
    const trimmed = expression.trim();

    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];

      if (c === '\\' && i + 1 < trimmed.length) {
        stripped += c + trimmed[++i];
        wasSpace = false;
        continue;
      }

      if ((c === '"' || c === "'") && (!quoted || c === quote)) {
        quoted = !quoted;
        quote = quoted ? c : '';
        stripped += c;
        wasSpace = false;
        continue;
      }

      if (quoted) {
        stripped += c;
        continue;
      }

      if (/\s/.test(c)) {
        if (!wasSpace) {
          stripped += ' ';
          wasSpace = true;
        }
        continue;
      }

      stripped += c;
      wasSpace = false;
    }

    return stripped;
  }

  /**
   * 式文字列をコンパイルしてキャッシュに登録する
   * @param expression - テンプレート式（`{{{...}}}` の内側）
   * @returns コンパイル済み評価関数
   */
  compile(expression: string): CompiledEvaluator {
    const key = LazyTemplate.stripWhitespaceWithoutStringLiteral(expression);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const fn = this.buildEvaluator(key);
    this.cache.set(key, fn);
    return fn;
  }

  /**
   * シングルクォートまたはダブルクォートで囲まれたトークンを文字列リテラルとしてパースする
   * @param token - パース対象トークン
   * @returns パース済み文字列、パース失敗時は undefined
   */
  static parseStringLiteral(token: string): string | undefined {
    token = token.trim();

    if (token.startsWith('"')) {
      try {
        return JSON.parse(token);
      } catch {
        return undefined;
      }
    }

    if (token.startsWith("'")) {
      const inner = token.slice(1, -1);
      const sentinel = LazyTemplate.BACKSLASH_SENTINEL;
      const quoted = `"${inner
        .replace(/\\\\/g, sentinel)
        .replace(/\\'/g, "'")
        .replaceAll(sentinel, '\\\\')
        .replace(/"/g, '\\"')
      }"`;
      try {
        return JSON.parse(quoted);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private applyFilters(value: unknown, filterNames: string[]): unknown {
    let v = value;
    for (const name of filterNames) {
      const fn = this.filters[name];
      if (typeof fn === 'function') {
        v = fn(v);
      }
    }
    return v;
  }

  private parseFilters(rawTerm: string): string[] {
    const segments: string[] = [];
    let current = '';

    for (const m of rawTerm.matchAll(new RegExp(LazyTemplate.OPERATOR_OR_TOKEN_PATTERN.source, 'g'))) {
      const token = m[0];
      if (token === '|') {
        segments.push(current.trim());
        current = '';
      } else {
        current += token;
      }
    }

    if (current.trim()) {
      segments.push(current.trim());
    }
    return segments;
  }

  private buildEvaluator(expression: string): CompiledEvaluator {
    const terms: string[] = [];
    let current = '';

    for (const m of expression.matchAll(new RegExp(LazyTemplate.OPERATOR_OR_TOKEN_PATTERN.source, 'g'))) {
      const token = m[0];
      if (token === '||') {
        const trimmed = current.trim();
        if (trimmed) {
          terms.push(trimmed);
        }
        current = '';
      } else {
        current += token;
      }
    }

    const trimmed = current.trim();
    if (trimmed) {
      terms.push(trimmed);
    }

    const compiled: CompiledEvaluator[] = terms.map(rawTerm => {
      const segments = this.parseFilters(rawTerm);
      const term = segments.shift();
      if (term === undefined) {
        return () => undefined;
      }
      const filterNames = segments;

      if (LazyTemplate.NUMBER_LITERAL_PATTERN.test(term)) {
        const n = Number(term);
        return () => this.applyFilters(n, filterNames);
      }

      if (term.startsWith('"') || term.startsWith("'")) {
        const value = LazyTemplate.parseStringLiteral(term);
        return () => this.applyFilters(value, filterNames);
      }

      if (term === '.') {
        return (data: object) => this.applyFilters(data, filterNames);
      }

      const path: (string | number)[] = [];
      let valid = true;

      for (const m of term.matchAll(new RegExp(LazyTemplate.KEY_SEGMENT_PATTERN.source, 'g'))) {
        const identifier = m[1];
        const bracket = m[2];

        if (identifier) {
          path.push(identifier);
        } else {
          let key: string | number | undefined;
          if (bracket.startsWith('"') || bracket.startsWith("'")) {
            key = LazyTemplate.parseStringLiteral(bracket);
          } else {
            key = Number(bracket);
          }
          if (key === undefined) {
            valid = false;
            break;
          }
          path.push(key);
        }
      }

      if (valid) {
        const rest = term
          .replace(new RegExp(LazyTemplate.KEY_SEGMENT_PATTERN.source, 'g'), '')
          .replace(/[.\s]/g, '');
        if (rest.length !== 0) {
          valid = false;
        }
      }

      if (!valid || path.length === 0) {
        return () => undefined;
      }

      return (data: object) => {
        let acc: unknown = data;
        for (const key of path) {
          if (acc == null) {
            return undefined;
          }
          const t = typeof acc;
          if (t !== 'object' && t !== 'function') {
            return undefined;
          }
          const value = (acc as Record<string | number, unknown>)[key];
          if (value === undefined) {
            return undefined;
          }
          acc = value;
        }
        return this.applyFilters(acc, filterNames);
      };
    });

    return (data: object) => {
      for (const fn of compiled) {
        const value = fn(data);
        if (value !== undefined && value !== null && value !== '') {
          return value;
        }
      }
      return '';
    };
  }

  /**
   * テンプレートを評価して文字列を返す
   * @param data - プレースホルダーに展開するデータオブジェクト
   * @returns 評価済み文字列
   * @throws {TypeError} data が null/undefined の場合
   */
  evaluate(data: object): string {
    if (data == null) {
      throw new TypeError('data にはオブジェクトを指定してください');
    }

    let text = '';

    for (const part of this.parts) {
      if (part.type === 'text') {
        text += part.value;
        continue;
      }

      if (part.backslashes.length === 0) {
        const result = this.compile(part.expression)(data);
        text += String(result);
      } else {
        text += part.backslashes.slice(1) + '{{{' + part.expression + '}}}';
      }
    }

    return text;
  }

  /**
   * テンプレートを1回だけ評価するワンショット静的メソッド
   * @param template - テンプレート文字列
   * @param data - プレースホルダーに展開するデータオブジェクト
   * @param filters - カスタムフィルターマップ
   * @returns 評価済み文字列
   * @throws {TypeError} template が文字列でない場合、または data が null/undefined の場合
   */
  static evaluate(template: string, data: object, filters: FilterMap = {}): string {
    return new LazyTemplate(template, filters).evaluate(data);
  }
}

export { LazyTemplate };
export type { FilterFn, FilterMap };

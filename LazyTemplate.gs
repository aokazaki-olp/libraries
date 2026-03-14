'use strict';

/**
 * LazyTemplate
 * 
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
 *   const template = new LazyTemplate('Hello {{{name}}}!');
 *   const result = template.evaluate({ name: 'World' });
 *   // => "Hello World!"
 */

(function(global) {

/**
 * LazyTemplate クラス
 * 
 * 遅延評価テンプレートエンジン
 * - プレースホルダー: {{{expression}}}
 * - フィルター: | filter1 | filter2
 * - フォールバック: || defaultValue
 * - プロパティアクセス: key.property, array[0], object["key"]
 */
class LazyTemplate {
  /**
   * 正規表現パターン定数
   */
  
  /** @type {RegExp} プレースホルダーパターン: {{{expression}}} */
  static PLACEHOLDER_PATTERN = /(\\*)\{\{\{([\s\S]*?)\}\}\}/g;
  
  /** @type {RegExp} 演算子・トークンパターン: "string" | 'string' | || | | | 任意文字 */
  static OPERATOR_OR_TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\|\||\||[\s\S]/g;
  
  /** @type {RegExp} キーセグメントパターン: identifier | ["string"] | ['string'] | [number] */
  static KEY_SEGMENT_PATTERN = /(?:^|\.)\s*([^\s.\[\]]+)|\[\s*(("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?(?:0|[1-9]\d*)(?:\.\d+)?)\s*)\]/g;
  
  /** @type {RegExp} 数値リテラルパターン */
  static NUMBER_LITERAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

  /** @type {string} \\ 一時退避センチネル: PUA（U+E000）で囲み自然なテキストとの衝突を回避 */
  static BACKSLASH_SENTINEL = '\uE000__LT_BS__\uE000';

  /** @type {Object.<string, Function>} プリミティブフィルター(18個) */
  static PRIMITIVE_FILTERS = {
    // 文字列操作
    
    /**
     * [文字列操作] 前後の空白を削除
     * 
     * @param {*} v 値
     * @returns {string|*} 空白削除後の文字列、または文字列でない場合は元の値
     */
    trim: v => typeof v === 'string' ? v.trim() : v,

    /**
     * [文字列操作] 先頭の空白を削除
     * 
     * @param {*} v 値
     * @returns {string|*} 先頭空白削除後の文字列、または文字列でない場合は元の値
     */
    trimStart: v => typeof v === 'string' ? v.trimStart() : v,

    /**
     * [文字列操作] 末尾の空白を削除
     * 
     * @param {*} v 値
     * @returns {string|*} 末尾空白削除後の文字列、または文字列でない場合は元の値
     */
    trimEnd: v => typeof v === 'string' ? v.trimEnd() : v,

    /**
     * [文字列操作] 大文字化
     * 
     * @param {*} v 値
     * @returns {string|*} 大文字の文字列、または文字列でない場合は元の値
     */
    upper: v => typeof v === 'string' ? v.toUpperCase() : v,

    /**
     * [文字列操作] 小文字化
     * 
     * @param {*} v 値
     * @returns {string|*} 小文字の文字列、または文字列でない場合は元の値
     */
    lower: v => typeof v === 'string' ? v.toLowerCase() : v,

    // 数値操作
    
    /**
     * [数値変換・操作] 四捨五入
     * 
     * @param {*} v 値
     * @returns {number|*} 四捨五入した値、または変換失敗時は元の値
     */
    round: v => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : v;
    },

    /**
     * [数値変換・操作] 整数化(小数点以下切り捨て)
     * 
     * @param {*} v 値
     * @returns {number|*} 整数、または変換失敗時は元の値
     */
    int: v => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : v;
    },

    /**
     * [数値変換・操作] 浮動小数点数化
     * 
     * @param {*} v 値
     * @returns {number|*} 浮動小数点数、または変換失敗時は元の値
     */
    float: v => {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    },

    /**
     * [数値変換・操作] 絶対値
     * 
     * @param {*} v 値
     * @returns {number|*} 絶対値、または変換失敗時は元の値
     */
    abs: v => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.abs(n) : v;
    },

    /**
     * [数値変換・操作] 切り上げ
     * 
     * @param {*} v 値
     * @returns {number|*} 切り上げた値、または変換失敗時は元の値
     */
    ceil: v => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.ceil(n) : v;
    },

    /**
     * [数値変換・操作] 切り捨て
     * 
     * @param {*} v 値
     * @returns {number|*} 切り捨てた値、または変換失敗時は元の値
     */
    floor: v => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.floor(n) : v;
    },

    /**
     * [数値変換・操作] 符号反転
     * 
     * @param {*} v 値
     * @returns {number|*} 符号を反転した値、または変換失敗時は元の値
     */
    negate: v => {
      const n = Number(v);
      return Number.isFinite(n) ? -n : v;
    },

    // 汎用
    
    /**
     * [汎用] 長さ取得(文字列または配列)
     * 
     * @param {*} v 値
     * @returns {number} 長さ、または対象でない場合は0
     */
    length: v => (typeof v === 'string' || Array.isArray(v)) ? v.length : 0,

    // 型変換
    
    /**
     * [基本型変換] 文字列化(null/undefinedは空文字に変換)
     * 
     * @param {*} v 値
     * @returns {string} 文字列
     */
    string: v => v == null ? '' : String(v),

    /**
     * [基本型変換] 真偽値化
     * 
     * @param {*} v 値
     * @returns {boolean} 真偽値
     */
    boolean: v => Boolean(v),

    // デフォルト値
    
    /**
     * [汎用] デフォルト値(null/undefinedを空文字に変換)
     * 
     * @param {*} v 値
     * @returns {*} null/undefinedの場合は空文字、それ以外は元の値
     */
    default: v => v == null ? '' : v,

    // JSON
    
    /**
     * [JSON] JSON文字列化(コンパクト形式)
     * 
     * @param {*} v 値
     * @returns {string} JSON文字列、または変換失敗時は"{}"
     */
    json: v => {
      try {
        return JSON.stringify(v);
      } catch { // 正常経路: シリアライズ不可オブジェクトの吸収
        return '{}';
      }
    },

    /**
     * [JSON] JSON文字列化(整形済み)
     * 
     * @param {*} v 値
     * @returns {string} 整形されたJSON文字列、または変換失敗時は"{}"
     */
    jsonPretty: v => {
      try {
        return JSON.stringify(v, null, 2);
      } catch { // 正常経路: シリアライズ不可オブジェクトの吸収
        return '{}';
      }
    }
  };

  /**
   * コンストラクター
   * 
   * @param {string} template テンプレート文字列
   * @param {Object} [filters={}] カスタムフィルター
   * @throws {TypeError} template に文字列以外が指定された場合
   */
  constructor(template, filters = {}) {
    if (typeof template !== 'string') {
      throw new TypeError('template には文字列を指定してください');
    }

    this.cache = new Map();
    this.parts = this.parseTemplate(template);

    // フィルター = プリミティブ + カスタム
    this.filters = {
      ...LazyTemplate.PRIMITIVE_FILTERS,
      ...filters,
    };
  }

  /**
   * フィルター登録(インスタンスメソッド)
   * 
   * @param {string} name フィルター名
   * @param {Function} fn フィルター関数
   * @throws {TypeError} name が文字列以外、または fn が関数以外の場合
   * @throws {Error} フィルター名が不正な形式の場合
   */
  registerFilter(name, fn) {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('name には空でない文字列を指定してください');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('fn には関数を指定してください');
    }

    this.filters[name] = fn;
  }

  /**
   * テンプレートのパース
   * 
   * @param {string} template テンプレート文字列
   * @returns {Array} パース結果
   */
  parseTemplate(template) {
    const p = [];
    let l = 0;

    for (const m of template.matchAll(LazyTemplate.PLACEHOLDER_PATTERN)) {
      if (m.index > l) {
        p.push({ type: 'text', value: template.slice(l, m.index) });
      }

      p.push({
        type: 'placeholder',
        backslashes: m[1],
        expression: m[2].trim(),
      });

      l = m.index + m[0].length;
    }

    if (l < template.length) {
      p.push({ type: 'text', value: template.slice(l) });
    }

    return p;
  }

  /**
   * 文字列リテラル以外の空白を正規化
   * 
   * @private
   * @param {string} expression 式
   * @returns {string} 正規化された式
   */
  static stripWhitespaceWithoutStringLiteral(expression) {
    let stripped = '';
    let quoted = false;
    let quote = '';
    let wasSpace = false;
    
    const trimmed = expression.trim();
    
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      
      // エスケープ
      if (c === '\\' && i + 1 < trimmed.length) {
        stripped += c + trimmed[++i];
        wasSpace = false;
        continue;
      }
      
      // 引用符
      if ((c === '"' || c === "'") && (!quoted || c === quote)) {
        quoted = !quoted;
        quote = quoted ? c : '';
        stripped += c;
        wasSpace = false;
        continue;
      }
      
      // 引用符内
      if (quoted) {
        stripped += c;
        continue;
      }
      
      // 空白圧縮
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
   * 式のコンパイル(キャッシュ付き)
   * 
   * @param {string} expression 式
   * @returns {Function} コンパイル済み関数
   */
  compile(expression) {
    // 式の正規化（文字列リテラル内の空白は保持、それ以外は圧縮）
    const key = LazyTemplate.stripWhitespaceWithoutStringLiteral(expression);
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const fn = this.buildEvaluator(key);
    this.cache.set(key, fn);
    return fn;
  }

  /**
   * 文字列リテラルのパース
   *
   * @param {string} token トークン（クォート付き文字列リテラル）
   * @returns {string|undefined} 解釈した文字列。トークンがリテラルでない場合は undefined
   */
  static parseStringLiteral(token) {
    // 前後の空白を削除
    token = token.trim();

    if (token.startsWith('"')) {
      try {
        return JSON.parse(token);
      } catch { // 正常経路: リテラルでない場合の吸収
        return undefined;
      }
    }

    if (token.startsWith("'")) {
      const inner = token.slice(1, -1);
      // \\ を一時退避してから \' を処理し、JSON.parse に委譲する
      const sentinel = LazyTemplate.BACKSLASH_SENTINEL;
      const quoted = `"${inner
        .replace(/\\\\/g, sentinel)  // \\ を一時退避
        .replace(/\\'/g, "'")         // \' を ' に変換
        .replaceAll(sentinel, '\\\\') // \\ を復元
        .replace(/"/g, '\\"')         // " を \" にエスケープ
      }"`;
      try {
        return JSON.parse(quoted);
      } catch { // 正常経路: リテラルでない場合の吸収
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * フィルター適用
   * 
   * @param {*} value 値
   * @param {Array<string>} filterNames フィルター名の配列
   * @returns {*} フィルター適用後の値
   */
  applyFilters(value, filterNames) {
    let v = value;
    for (const name of filterNames) {
      const fn = this.filters[name];
      if (typeof fn === 'function') {
        v = fn(v);
      }
    }
    return v;
  }

  /**
   * フィルターで分割(安全な分割)
   * 
   * @param {string} rawTerm 項
   * @returns {Array<string>} 分割結果
   */
  parseFilters(rawTerm) {
    const segments = [];
    let current = '';

    for (const m of rawTerm.matchAll(LazyTemplate.OPERATOR_OR_TOKEN_PATTERN)) {
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

  /**
   * 式のビルド
   * 
   * @param {string} expression 式
   * @returns {Function} ビルド済み関数
   */
  buildEvaluator(expression) {
    // || で項を分割（フォールバック）
    const terms = [];
    let current = '';

    for (const m of expression.matchAll(LazyTemplate.OPERATOR_OR_TOKEN_PATTERN)) {
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

    {
      const trimmed = current.trim();
      if (trimmed) {
        terms.push(trimmed);
      }
    }

    // 各項をコンパイル
    const compiled = terms.map(rawTerm => {
      // フィルターで分割
      const segments = this.parseFilters(rawTerm);
      const term = segments.shift();
      const filters = segments;

      // 数値リテラル
      if (LazyTemplate.NUMBER_LITERAL_PATTERN.test(term)) {
        const n = Number(term);
        return () => this.applyFilters(n, filters);
      }

      // 文字列リテラル
      if (term.startsWith('"') || term.startsWith("'")) {
        const value = LazyTemplate.parseStringLiteral(term);
        return () => this.applyFilters(value, filters);
      }

      // 特殊ケース: "." はデータ全体を参照
      if (term === '.') {
        return data => this.applyFilters(data, filters);
      }

      // キー参照
      const path = [];
      let valid = true;

      for (const m of term.matchAll(LazyTemplate.KEY_SEGMENT_PATTERN)) {
        const identifier = m[1];
        const bracket = m[2];

        if (identifier) {
          path.push(identifier);
        } else {
          let key;
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
          .replace(LazyTemplate.KEY_SEGMENT_PATTERN, '')
          .replace(/[.\s]/g, '');
        if (rest.length !== 0) {
          valid = false;
        }
      }

      if (!valid || path.length === 0) {
        return () => undefined;
      }

      return data => {
        let accumulator = data;
        for (const key of path) {
          if (accumulator == null) {
            return undefined;
          }
          const type = typeof accumulator;
          if (type !== 'object' && type !== 'function') {
            return undefined;
          }

          const value = accumulator[key];
          if (value === undefined) {
            return undefined;
          }
          accumulator = value;
        }
        return this.applyFilters(accumulator, filters);
      };
    });

    // フォールバック評価
    return data => {
      for (const fn of compiled) {
        const value = fn(data);
        if (value === undefined || value === null || value === '') {
          continue;
        }
        return value;
      }
      return '';
    };
  }

  /**
   * 評価
   * 
   * @param {Object} data 展開するデータ
   * @returns {string} 展開後の文字列
   * @throws {TypeError} data がオブジェクトでない場合
   */
  evaluate(data) {
    if (data == null) {
      throw new TypeError('data にはオブジェクトを指定してください');
    }

    let text = '';

    for (const part of this.parts) {
      if (part.type === 'text') {
        text += part.value;
        continue;
      }

      // プレースホルダー
      if (part.backslashes.length === 0) {
        // バックスラッシュなし → 評価
        const result = this.compile(part.expression)(data);
        text += String(result);
      } else {
        // バックスラッシュあり → 評価しない（1個減らす）
        text += part.backslashes.slice(1) + '{{{' + part.expression + '}}}';
      }
    }

    return text;
  }

  /**
   * 静的メソッド: ワンショット評価
   * キャッシュの恩恵なし、使い捨て用
   * 
   * @param {string} template テンプレート文字列
   * @param {Object} data データオブジェクト
   * @param {Object} [filters={}] カスタムフィルター
   * @returns {string} 展開後の文字列
   * @throws {TypeError} コンストラクターまたは evaluate で発生する型エラー
   */
  static evaluate(template, data, filters = {}) {
    return new LazyTemplate(template, filters).evaluate(data);
  }
}

// エクスポート処理
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS環境
  module.exports = LazyTemplate;
} else if (typeof window !== 'undefined') {
  // ブラウザ環境
  window.LazyTemplate = LazyTemplate;
} else if (typeof global !== 'undefined') {
  // GAS環境 / その他
  global.LazyTemplate = LazyTemplate;
}

})(this);

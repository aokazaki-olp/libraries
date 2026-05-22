'use strict';

/**
 * 各エントリは:
 *  canonical: 正式名称
 *  kind:      国税庁 kind コード
 *  position:  'pre'=前株, 'post'=後株, 'both'=両対応
 *  aliases:   正規化時に canonical に統一すべき表記一覧
 */
const LEGAL_ENTITY_DEFINITIONS = [
  {
    canonical: '株式会社',
    kind: '301',
    position: 'both',
    aliases: [
      '㈱', '(株)', '（株）', '(株', '株)', '（株', '株）',
      'ｶﾌﾞｼｷｶｲｼｬ',
      'KK', 'K.K.', 'K.K', 'KK.', 'Co.,Ltd.', 'Co., Ltd.',
      'Co.,Ltd', 'Co.Ltd.', 'Co.Ltd', 'Corp.', 'Corp',
      'Inc.', 'Inc', 'Ltd.', 'Ltd',
      'ＫＫ',
      '（株式会社）',
    ],
  },
  {
    canonical: '有限会社',
    kind: '302',
    position: 'both',
    aliases: [
      '㈲', '(有)', '（有）', '(有', '有)', '（有', '有）',
      'ﾕｳｹﾞﾝｶｲｼｬ',
      '有限',
    ],
  },
  {
    canonical: '合同会社',
    kind: '305',
    position: 'both',
    aliases: [
      '(同)', '（同）', '(同', '同)', '（同', '同）',
      'LLC', 'L.L.C.', 'L.L.C', 'GK',
      'ゴウドウカイシャ',
      '合同',
    ],
  },
  {
    canonical: '合名会社',
    kind: '303',
    position: 'both',
    aliases: [
      '(名)', '（名）', '(名', '名)', '（名', '名）',
    ],
  },
  {
    canonical: '合資会社',
    kind: '304',
    position: 'both',
    aliases: [
      '(資)', '（資）', '(資', '資)', '（資', '資）',
    ],
  },
  {
    canonical: '医療法人',
    kind: '399',
    position: 'both',
    aliases: ['（医）', '(医)', '医療法人社団', '医療法人財団'],
  },
  {
    canonical: '社会福祉法人',
    kind: '399',
    position: 'both',
    aliases: ['（福）', '(福)', '社福'],
  },
  {
    canonical: '学校法人',
    kind: '399',
    position: 'both',
    aliases: ['（学）', '(学)'],
  },
  {
    canonical: '宗教法人',
    kind: '399',
    position: 'both',
    aliases: ['（宗）', '(宗)'],
  },
  {
    canonical: '一般社団法人',
    kind: '399',
    position: 'both',
    aliases: ['（一社）', '(一社)', '一社'],
  },
  {
    canonical: '公益社団法人',
    kind: '399',
    position: 'both',
    aliases: ['（公社）', '(公社)', '公社'],
  },
  {
    canonical: '一般財団法人',
    kind: '399',
    position: 'both',
    aliases: ['（一財）', '(一財)', '一財'],
  },
  {
    canonical: '公益財団法人',
    kind: '399',
    position: 'both',
    aliases: ['（公財）', '(公財)', '公財'],
  },
  {
    canonical: '特定非営利活動法人',
    kind: '399',
    position: 'both',
    aliases: ['NPO法人', 'NPO', '(NPO)', '（NPO）', '特非'],
  },
  {
    canonical: '協同組合',
    kind: '399',
    position: 'both',
    aliases: ['（協組）', '(協組)', '協組'],
  },
  {
    canonical: '農業協同組合',
    kind: '399',
    position: 'both',
    aliases: ['農協', 'JA'],
  },
  {
    canonical: '独立行政法人',
    kind: '399',
    position: 'pre',
    aliases: ['独法', '（独）', '(独)'],
  },
  {
    canonical: '国立大学法人',
    kind: '399',
    position: 'pre',
    aliases: [],
  },
  {
    canonical: '地方独立行政法人',
    kind: '399',
    position: 'pre',
    aliases: [],
  },
  {
    canonical: '投資法人',
    kind: '399',
    position: 'both',
    aliases: ['（投）', '(投)'],
  },
  {
    canonical: '信用金庫',
    kind: '399',
    position: 'both',
    aliases: ['信金'],
  },
  {
    canonical: '信用組合',
    kind: '399',
    position: 'both',
    aliases: [],
  },
];

module.exports = { LEGAL_ENTITY_DEFINITIONS };

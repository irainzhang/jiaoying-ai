/*!
 * 城市韧性守护 Agent · 预案知识检索（RAG）
 * ---------------------------------------------------------------
 * 对应 Word 文档「RAG：大模型 + 应急预案知识库」。
 *
 * 本构建的口径必须如实说明：
 *   - 检索是本地关键词/词频打分（中文二元切分 + 领域同义词扩展），不是向量检索；
 *   - 知识库是公开防汛文件的「概括性摘要」，不是原文，不得当作法条引用；
 *   - 检索不到依据时必须直说「没有检索到相关依据」，绝不编造规定。
 *   若要升级为向量库，可接 chroma / qdrant，只需替换 FA.rag.search 的实现。
 */
(function (FA) {
  'use strict';

  /* 领域同义词扩展：让「老人」也能命中「老龄」等表述 */
  var SYNONYMS = {
    '雨量': ['降雨', '暴雨', '强降雨', '降水'],
    '暴雨': ['强降雨', '降雨', '内涝'],
    '积水': ['内涝', '易涝', '涝点'],
    '内涝': ['积水', '易涝'],
    '老人': ['老龄', '老年', '高龄'],
    '老龄': ['老人', '老年'],
    '儿童': ['未成年', '少年儿童'],
    '转移': ['避险', '撤离', '疏散'],
    '避险': ['转移', '撤离'],
    '避难点': ['安置点', '避难场所', '安置场所'],
    '安置点': ['避难点', '避难场所', '安置场所'],
    '预案': ['应急预案', '防汛预案'],
    '预警': ['警报', '预警信号'],
    '响应': ['应急响应', '启动响应'],
    '车辆': ['运力', '车辆调度'],
    '物资': ['应急物资', '抢险物资'],
    '责任人': ['防汛责任人', '行政责任人'],
    '演练': ['演习', '应急演练']
  };

  var CJK = /[\u4e00-\u9fa5]/;
  var STOP = { '的': 1, '了': 1, '和': 1, '与': 1, '及': 1, '在': 1, '是': 1, '有': 1, '为': 1, '对': 1, '等': 1, '应': 1, '要': 1, '按': 1, '并': 1, '或': 1, '中': 1, '上': 1, '下': 1, '人': 1, '的的': 1 };

  /** 中文二元切分 + 英文/数字词 */
  function tokenize(text) {
    var s = String(text || '').toLowerCase();
    var tokens = [];
    var latin = s.match(/[a-z0-9][a-z0-9\-_.]{1,}/g) || [];
    latin.forEach(function (w) { tokens.push(w); });
    var han = s.replace(/[^\u4e00-\u9fa5]+/g, ' ');
    han.split(/\s+/).forEach(function (seg) {
      if (!seg) return;
      if (seg.length === 1) { tokens.push(seg); return; }
      for (var i = 0; i < seg.length - 1; i++) {
        var bi = seg.substr(i, 2);
        if (STOP[bi]) continue;
        tokens.push(bi);
      }
      // 同时保留较长词片段，提升「应急预案」这类长词权重
      for (var L = 3; L <= 4; L++) {
        for (var j = 0; j + L <= seg.length; j++) tokens.push(seg.substr(j, L));
      }
    });
    return tokens;
  }

  function expand(query) {
    var base = tokenize(query);
    var extra = [];
    Object.keys(SYNONYMS).forEach(function (key) {
      if (String(query).indexOf(key) >= 0) {
        SYNONYMS[key].forEach(function (syn) { extra = extra.concat(tokenize(syn)); });
      }
    });
    return { primary: base, expanded: extra };
  }

  function splitChunks(body) {
    // 以标题行与列表项为界切块，保留可引用的最小语义单元
    var lines = String(body || '').split(/\r?\n/);
    var chunks = [], buf = [];
    function flush() {
      var text = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (text.length >= 6) chunks.push(text);
      buf = [];
    }
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) { flush(); return; }
      if (/^#{1,6}\s/.test(t) || /^[-*•]\s+/.test(t) || /^\d+[.、)]\s*/.test(t)) { flush(); }
      buf.push(t.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '').replace(/^\d+[.、)]\s*/, ''));
    });
    flush();
    return chunks;
  }

  var indexCache = null;

  function buildIndex() {
    var docs = FA.kbDocs || [];
    var chunks = [];
    var df = {};
    docs.forEach(function (doc) {
      splitChunks(doc.body).forEach(function (text, i) {
        var tokens = tokenize(text);
        var uniq = {};
        tokens.forEach(function (t) { uniq[t] = 1; });
        Object.keys(uniq).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
        chunks.push({
          id: doc.id + '#' + (i + 1),
          docId: doc.id,
          title: doc.title,
          publisher: doc.publisher,
          url: doc.url,
          retrievedAt: doc.retrievedAt,
          category: doc.category,
          text: text,
          tokens: tokens
        });
      });
    });
    // 计算 idf
    var N = Math.max(1, chunks.length);
    chunks.forEach(function (c) {
      var tf = {};
      c.tokens.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      c.tf = tf;
      c.length = c.tokens.length || 1;
    });
    indexCache = { chunks: chunks, df: df, N: N, docs: docs };
    return indexCache;
  }

  function ensureIndex() {
    if (!indexCache) buildIndex();
    return indexCache;
  }

  function scoreChunk(chunk, idx, q) {
    var score = 0, hits = [];
    function add(tokens, weight) {
      tokens.forEach(function (t) {
        var f = chunk.tf[t];
        if (!f) return;
        var idf = Math.log(1 + idx.N / (1 + (idx.df[t] || 0)));
        var s = (f / chunk.length) * 100 * idf * weight;
        score += s;
        if (hits.indexOf(t) < 0 && t.length >= 2) hits.push(t);
      });
    }
    add(q.primary, 1.0);
    add(q.expanded, 0.45);
    return { score: score, hits: hits };
  }

  FA.rag = {
    SYNONYMS: SYNONYMS,
    tokenize: tokenize,

    /** 知识库概览 */
    status: function () {
      var idx = ensureIndex();
      return {
        loaded: !!(FA.kbDocs && FA.kbDocs.length),
        docCount: (FA.kbDocs || []).length,
        chunkCount: idx.chunks.length,
        method: 'local-keyword-tfidf',
        methodLabel: '本地关键词 / 词频打分检索（中文二元切分 + 领域同义词扩展）',
        methodNote: '这是可离线运行的关键词检索，不是向量检索；升级为向量库只需替换本模块的实现。',
        upgradePath: '可接入 chroma 或 qdrant 做向量检索，工具契约与引用格式保持不变。',
        sources: (FA.kbDocs || []).map(function (d) {
          return { id: d.id, title: d.title, publisher: d.publisher, url: d.url, category: d.category };
        })
      };
    },

    rebuild: function () { indexCache = null; return this.status(); },

    /**
     * 检索
     * @returns {{ok:boolean, hits:Array, note:string}}
     */
    search: function (query, topK) {
      var idx = ensureIndex();
      if (!idx.chunks.length) {
        return {
          ok: false,
          hits: [],
          note: '知识库为空（未加载 assets/kb-bundle.js）。请先在项目根目录执行 node scripts/build-bundles.mjs 生成知识库索引。',
          method: 'local-keyword-tfidf'
        };
      }
      var q = expand(query || '');
      if (!q.primary.length && !q.expanded.length) {
        return { ok: false, hits: [], note: '检索词为空。', method: 'local-keyword-tfidf' };
      }
      var scored = idx.chunks.map(function (c) {
        var r = scoreChunk(c, idx, q);
        return { chunk: c, score: r.score, hits: r.hits };
      }).filter(function (x) { return x.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, topK || 3);

      return {
        ok: scored.length > 0,
        method: 'local-keyword-tfidf',
        methodLabel: '本地关键词 / 词频打分检索',
        query: query,
        expandedTerms: q.expanded.filter(function (t, i, arr) { return t.length >= 2 && arr.indexOf(t) === i; }).slice(0, 12),
        hits: scored.map(function (x) {
          return {
            id: x.chunk.id,
            title: x.chunk.title,
            publisher: x.chunk.publisher,
            url: x.chunk.url,
            retrievedAt: x.chunk.retrievedAt,
            category: x.chunk.category,
            score: FA.util.round(x.score, 3),
            matchedTerms: x.hits.slice(0, 6),
            text: x.chunk.text
          };
        }),
        note: scored.length
          ? '以下为公开文件的概括性摘要片段，用于说明依据方向；原文以官方发布为准。'
          : '没有检索到与「' + query + '」相关的依据。本系统不会在没有检索结果时编造规定。'
      };
    }
  };

  /* ============================ 工具：预案检索 ============================ */
  FA.tools.register({
    name: 'search_plan_knowledge',
    label: '检索公开防汛预案',
    group: '预案依据',
    description: '在公开防汛应急预案与应急规范摘要知识库中检索与问题相关的依据片段。检索为本地关键词打分（非向量检索）。每条结果都附带文件名、发布机构与公开链接，可直接作为建议的依据引用；若检索不到相关依据，必须如实说明而不是编造规定。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题，例如「老人 转移 优先顺序」' },
        topK: { type: 'integer', minimum: 1, maximum: 8, description: '返回条数，默认 3' }
      },
      required: ['query']
    },
    mutates: false,
    handler: function (args) {
      var res = FA.rag.search(args.query, args.topK || 3);
      var status = FA.rag.status();

      FA.store.patch({ knowledge: res.hits }, { label: '已检索预案依据', detail: '命中 ' + res.hits.length + ' 条', silent: true, reason: 'knowledge' });

      var citations = res.hits.map(function (h) {
        return { title: h.title, publisher: h.publisher, url: h.url, snippet: h.text, score: h.score };
      });

      if (!res.ok) {
        return {
          ok: false,
          summary: res.note,
          data: { query: args.query, hits: [], knowledgeBase: status },
          citations: [],
          actions: [
            FA.actions.factory.rag('强降雨 人员转移 优先顺序'),
            FA.actions.factory.rag('安置点 设置 容量')
          ],
          warnings: ['没有检索到依据时，不应给出「按规定应当……」这类表述。']
        };
      }

      return {
        ok: true,
        summary: '检索到 ' + res.hits.length + ' 条相关依据，首条来自《' + res.hits[0].title + '》' +
          (res.hits[0].publisher ? '（' + res.hits[0].publisher + '）' : '') + '：' + res.hits[0].text.slice(0, 80) + '…',
        data: {
          query: args.query,
          method: res.method,
          methodLabel: res.methodLabel,
          expandedTerms: res.expandedTerms,
          note: res.note,
          hits: res.hits,
          knowledgeBase: status
        },
        citations: citations,
        actions: [
          FA.actions.factory.report(),
          FA.actions.make({
            label: '看知识库来源清单',
            kind: 'view',
            args: { view: 'monitor-knowledge' },
            group: '查看',
            hint: '查看已收录的公开文件、发布机构与链接'
          })
        ],
        warnings: [
          '知识库内容为公开文件的概括性摘要，不是原文；引用时须以官方发布文本为准。',
          FA.rag.status().methodNote
        ]
      };
    }
  });
})(window.FA = window.FA || {});

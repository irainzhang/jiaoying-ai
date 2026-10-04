/*!
 * 城市韧性守护 Agent · Skill 注册表
 * ---------------------------------------------------------------
 * 遵循 Anthropic Agent Skills 规范（https://github.com/anthropics/skills）：
 *   - 每个技能是一个 SKILL.md，YAML frontmatter 提供 name 与 description；
 *   - 采用「渐进式披露」：默认只加载 name + description（便于模型判断要用哪个技能），
 *     body 只有在该技能被选中时才取用，避免一次性塞满上下文；
 *   - 技能本身不含数值逻辑，数值一律由 FA.tools 里的工具计算。
 *
 * 本项目的 SKILL.md 是真实文件（agent/src/skills/<name>/SKILL.md），
 * 由 scripts/build-bundles.mjs 内联成 assets/skills-bundle.js，
 * 以便在 file:// 下也能直接运行（file:// 不允许 fetch 本地文件）。
 */
(function (FA) {
  'use strict';

  var skills = null;      // 惰性加载

  /** 解析 YAML frontmatter（只支持本项目用到的简单标量格式） */
  function parseFrontmatter(text) {
    var src = String(text || '');
    var meta = {}, body = src;
    var m = src.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (m) {
      m[1].split(/\r?\n/).forEach(function (line) {
        var mm = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
        if (!mm) return;
        var key = mm[1].trim();
        var val = mm[2].trim().replace(/^["']|["']$/g, '');
        meta[key] = val;
      });
      body = src.slice(m[0].length);
    }
    return { meta: meta, body: body.trim() };
  }

  /** 从正文中找出该技能引用的工具（用于界面展示与一致性检查） */
  function extractTools(body, known) {
    var found = [];
    known.forEach(function (name) {
      if (body.indexOf(name) >= 0 && found.indexOf(name) < 0) found.push(name);
    });
    return found;
  }

  function load() {
    if (skills) return skills;
    skills = [];
    var sources = FA.skillSources || [];
    var known = FA.tools ? FA.tools.names() : [];
    sources.forEach(function (src) {
      var parsed = parseFrontmatter(src.text);
      var name = parsed.meta.name || (src.path || '').split('/').slice(-2)[0] || 'unnamed-skill';
      skills.push({
        name: name,
        description: parsed.meta.description || '',
        license: parsed.meta.license || '',
        path: src.path,
        body: parsed.body,
        meta: parsed.meta,
        tools: extractTools(parsed.body, known),
        lineCount: parsed.body.split(/\r?\n/).length
      });
    });
    return skills;
  }

  FA.skills = {
    /** 强制重新加载（换了 bundle 之后调用） */
    reload: function () { skills = null; return this.status(); },

    status: function () {
      var list = load();
      return {
        loaded: list.length > 0,
        count: list.length,
        spec: 'Anthropic Agent Skills（SKILL.md + YAML frontmatter + 渐进式披露）',
        source: FA.skillSources ? 'assets/skills-bundle.js' : '（未加载 bundle）',
        buildHint: list.length ? '' : '请先在项目根目录执行：node scripts/build-bundles.mjs',
        names: list.map(function (s) { return s.name; })
      };
    },

    /** 目录：只给 name + description（渐进式披露的第一层） */
    catalog: function () {
      return load().map(function (s) {
        return { name: s.name, description: s.description, tools: s.tools, path: s.path, lineCount: s.lineCount };
      });
    },

    /** 取技能全文（第二层：被选中时才取用） */
    body: function (name) {
      var s = load().find(function (x) { return x.name === name; });
      return s ? s.body : null;
    },

    get: function (name) {
      return load().find(function (x) { return x.name === name; }) || null;
    },

    /** 按关键词找相关技能（离线引擎与界面用） */
    find: function (query) {
      var q = String(query || '').toLowerCase();
      if (!q) return [];
      return load().filter(function (s) {
        return (s.name + ' ' + s.description + ' ' + s.body).toLowerCase().indexOf(q) >= 0;
      });
    },

    /** 一致性检查：技能里提到的工具是否都真实存在 */
    validate: function () {
      var list = load();
      var known = FA.tools ? FA.tools.names() : [];
      var issues = [];

      // 参数取值也长成 snake_case（例如 risk_first、map-longpress 转换后的形式），
      // 因此先从工具 schema 里收集所有合法取值与参数名，避免把它们误判成工具。
      var notTools = {};
      if (FA.tools) {
        FA.tools.all().forEach(function (t) {
          var props = (t.parameters && t.parameters.properties) || {};
          Object.keys(props).forEach(function (p) {
            notTools[p] = 1;
            var en = props[p].enum;
            if (en) en.forEach(function (v) { notTools[String(v).replace(/-/g, '_')] = 1; });
          });
        });
      }
      ['true', 'false', 'null', 'markdown', 'json', 'clipboard'].forEach(function (w) { notTools[w] = 1; });

      list.forEach(function (s) {
        if (!s.description) issues.push(s.name + '：缺少 description，模型无法判断何时使用该技能');
        if (!s.body || s.body.length < 80) issues.push(s.name + '：正文过短');

        // 只把「反引号包裹」或「后接左括号」的标识符当作工具引用
        var candidates = {};
        var reTick = /`([a-z][a-z0-9_]{3,})`/g;
        var reCall = /\b([a-z][a-z0-9_]{3,})\s*\(/g;
        var m;
        while ((m = reTick.exec(s.body)) !== null) candidates[m[1]] = 1;
        while ((m = reCall.exec(s.body)) !== null) candidates[m[1]] = 1;

        Object.keys(candidates).forEach(function (token) {
          if (known.indexOf(token) >= 0) return;
          if (notTools[token]) return;                        // 是参数名或取值，不是工具
          if (token.indexOf('_') < 0) return;                 // 工具名一定含下划线
          issues.push(s.name + '：正文提到未注册的工具 ' + token);
        });
      });
      return { ok: issues.length === 0, issues: issues, count: list.length };
    },

    parseFrontmatter: parseFrontmatter
  };
})(window.FA = window.FA || {});

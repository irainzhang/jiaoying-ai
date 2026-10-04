/*!
 * 城市韧性守护 Agent · 渲染与交互基础件
 * 极简 Markdown 渲染、元素构造、提示条、模态确认弹层。
 * 全部自研，零依赖：避免现场因 CDN 或版本问题导致界面白屏。
 */
(function (FA) {
  'use strict';

  FA.ui = FA.ui || {};

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 极简 Markdown → HTML（只支持本项目实际用到的语法，避免引入解析器）
   * **粗体**、`代码`、#### 标题、- / 1. 列表、空行分段
   */
  function mdToHtml(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var out = [], inUl = false, inOl = false;

    function closeLists() {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    }

    function inline(s) {
      return escapeHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { closeLists(); return; }
      if (/^#{1,6}\s/.test(line)) {
        closeLists();
        var level = Math.min(6, (line.match(/^#+/) || ['#'])[0].length);
        out.push('<h4>' + inline(line.replace(/^#+\s*/, '')) + '</h4>');
        return;
      }
      if (/^[-*•]\s+/.test(line)) {
        if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
        out.push('<li>' + inline(line.replace(/^[-*•]\s+/, '')) + '</li>');
        return;
      }
      if (/^\d+[.、)]\s*/.test(line)) {
        if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
        out.push('<li>' + inline(line.replace(/^\d+[.、)]\s*/, '')) + '</li>');
        return;
      }
      closeLists();
      out.push('<p>' + inline(line) + '</p>');
    });
    closeLists();
    return out.join('');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function toast(message, kind, ms) {
    var host = document.querySelector('.toast-host');
    if (!host) {
      host = el('div', { class: 'toast-host' });
      document.body.appendChild(host);
    }
    var node = el('div', { class: 'toast ' + (kind || ''), text: message });
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 260);
    }, ms || 3600);
  }

  /**
   * 模态框。返回 Promise：确认 resolve(表单值)，取消 resolve(null)。
   * 用于人工确认闸门与险情上报，保证「人工确认」是真实的一次点击。
   */
  function modal(opts) {
    return new Promise(function (resolve) {
      var fields = opts.fields || [];
      var inputs = {};
      var settled = false;
      var body = el('div', { class: 'modal-body' });

      if (opts.html) body.appendChild(el('div', { html: opts.html }));
      if (opts.text) body.appendChild(el('p', { text: opts.text }));

      fields.forEach(function (f) {
        var wrap = el('div', { class: 'field' });
        wrap.appendChild(el('label', { text: f.label + (f.required ? '（必填）' : '') }));
        var input;
        if (f.type === 'select') {
          input = el('select');
          (f.options || []).forEach(function (o) {
            input.appendChild(el('option', { value: o.value, text: o.label, selected: o.value === f.value ? 'selected' : null }));
          });
        } else if (f.type === 'textarea') {
          input = el('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '' });
          input.value = f.value || '';
        } else {
          input = el('input', { type: f.type || 'text', placeholder: f.placeholder || '', value: f.value == null ? '' : f.value });
        }
        if (f.hint) wrap.appendChild(el('div', { class: 'small muted mt6', text: f.hint }));
        wrap.insertBefore(input, wrap.lastChild);
        body.appendChild(wrap);
        inputs[f.key] = input;
      });

      var mask = el('div', { class: 'modal-mask' });
      var confirmBtn = el('button', {
        class: opts.danger ? 'btn-danger' : 'btn-primary',
        text: opts.confirmText || '确认'
      });
      var cancelBtn = el('button', { class: 'btn-secondary', text: opts.cancelText || '取消' });

      var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '确认' }, [
        el('div', { class: 'modal-head' }, [el('h3', { text: opts.title || '确认' })]),
        body,
        el('div', { class: 'modal-foot' }, [cancelBtn, confirmBtn])
      ]);
      mask.appendChild(box);
      document.body.appendChild(mask);

      function finish(value) {
        if (settled) return;
        settled = true;
        mask.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }
      function onKey(e) { if (e.key === 'Escape') finish(null); }
      document.addEventListener('keydown', onKey);

      cancelBtn.addEventListener('click', function () { finish(null); });
      confirmBtn.addEventListener('click', function (event) {
        if (opts.requireHuman && !(typeof Event !== 'undefined' && event instanceof Event && event.isTrusted === true)) {
          toast('请在确认框中亲自点击确认，禁止程序自动批准。', 'err');
          return;
        }
        var values = {};
        var missing = null;
        fields.forEach(function (f) {
          var v = inputs[f.key].value;
          if (f.required && !String(v).trim()) missing = missing || f.label;
          values[f.key] = f.type === 'number' ? Number(v) : String(v).trim();
        });
        if (missing) { toast('请填写：' + missing, 'err'); return; }
        // The non-enumerable native Event stays local; it is never serialized to messages or reports.
        if (opts.requireHuman) Object.defineProperty(values, '_humanEvent', { value: event });
        finish(values);
      });
      mask.addEventListener('click', function (e) { if (e.target === mask) finish(null); });
      setTimeout(function () { var first = box.querySelector('input,select,textarea'); if (first) first.focus(); }, 30);
    });
  }

  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) {
      toast('导出失败：' + (e.message || e), 'err');
      return false;
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      var ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  FA.ui.escapeHtml = escapeHtml;
  FA.ui.md = mdToHtml;
  FA.ui.el = el;
  FA.ui.toast = toast;
  FA.ui.modal = modal;
  FA.ui.download = download;
  FA.ui.copyText = copyText;
})(window.FA = window.FA || {});

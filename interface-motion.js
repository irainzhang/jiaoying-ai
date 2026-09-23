/* Presentation-only interaction feedback. No requests, timers, or state from the exercise are changed. */
(function () {
  'use strict';
  if (window.JiaoyingMotion) return;

  const selector = 'button, a.button, nav a, [role="button"]';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const effects = new Set();
  const pressed = new Map();
  let layer, status, labelNode, detailNode, iconNode, trackNode;
  let dismissTimer, hideTimer;

  function refresh() {
    if (!document.body) return;
    document.documentElement.classList.add('jy-motion-ready');
    if (layer && layer.isConnected && status && status.isConnected) return;
    clear();
    if (layer) layer.remove();
    if (status) status.remove();
    layer = document.createElement('div');
    layer.className = 'jy-motion-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    status = document.createElement('div');
    status.className = 'jy-motion-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = true;
    iconNode = document.createElement('span');
    iconNode.className = 'jy-motion-status-icon';
    iconNode.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    content.className = 'jy-motion-status-content';
    labelNode = document.createElement('strong');
    detailNode = document.createElement('span');
    content.append(labelNode, detailNode);
    trackNode = document.createElement('div');
    trackNode.className = 'jy-motion-status-track';
    trackNode.setAttribute('aria-hidden', 'true');
    trackNode.appendChild(document.createElement('i'));
    status.append(iconNode, content, trackNode);
    // Status is separate from the aria-hidden visual-effect layer.
    document.body.appendChild(status);
  }

  function eligible(event) {
    const origin = event.target instanceof Element ? event.target : null;
    const target = origin && origin.closest(selector);
    if (!target || target.matches(':disabled') || target.closest('[inert], [aria-disabled="true"]')) return null;
    return target;
  }

  function forgetEffect(effect) {
    clearTimeout(effect.timer);
    effect.node.remove();
    effects.delete(effect);
  }

  function showPress(target, x, y) {
    refresh();
    if (!layer || document.hidden) return;
    if (pressed.has(target)) clearTimeout(pressed.get(target));
    target.classList.add('jy-press');
    pressed.set(target, setTimeout(() => {
      target.classList.remove('jy-press');
      pressed.delete(target);
    }, 240));
    // Reduced-motion users receive a static border/glow confirmation only.
    if (reduced.matches) return;
    while (effects.size >= 6) forgetEffect(effects.values().next().value);
    const ring = document.createElement('span');
    ring.className = 'jy-click-ring';
    if (target.classList.contains('danger')) ring.classList.add('is-danger');
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    layer.appendChild(ring);
    const effect = { node: ring, timer: null };
    effects.add(effect);
    effect.timer = setTimeout(() => forgetEffect(effect), 620);
  }

  function cancelDismissal() {
    clearTimeout(dismissTimer);
    clearTimeout(hideTimer);
  }

  function showStatus(text, kind) {
    refresh();
    if (!status || document.hidden) return false;
    cancelDismissal();
    status.hidden = false;
    status.classList.remove('is-leaving');
    status.dataset.state = kind;
    labelNode.textContent = String(text || (kind === 'pending' ? '正在处理操作' : '操作完成')).slice(0, 160);
    detailNode.textContent = kind === 'pending' ? '正在处理，请稍候' : kind === 'error' ? '请查看提示并重试' : '结果已更新';
    iconNode.textContent = kind === 'pending' ? '↻' : kind === 'error' ? '!' : '✓';
    return true;
  }

  function begin(label) {
    showStatus(label, 'pending');
  }

  function finish(label, kind = 'success') {
    const result = kind === 'error' || kind === 'failure' ? 'error' : 'success';
    if (!showStatus(label, result)) return;
    dismissTimer = setTimeout(() => {
      status.classList.add('is-leaving');
      hideTimer = setTimeout(() => {
        status.hidden = true;
        status.classList.remove('is-leaving');
      }, reduced.matches ? 0 : 180);
    }, result === 'error' ? 4600 : 2600);
  }

  function clear() {
    cancelDismissal();
    for (const effect of Array.from(effects)) forgetEffect(effect);
    for (const [target, timer] of pressed) {
      clearTimeout(timer);
      target.classList.remove('jy-press');
    }
    pressed.clear();
    if (status) {
      status.hidden = true;
      status.classList.remove('is-leaving');
    }
  }

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = eligible(event);
    if (target) showPress(target, event.clientX, event.clientY);
  }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    // detail === 0 includes keyboard and assistive-technology activation.
    if (event.detail !== 0) return;
    const target = eligible(event);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    showPress(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  window.addEventListener('pagehide', clear);
  if (typeof reduced.addEventListener === 'function') reduced.addEventListener('change', clear);
  window.JiaoyingMotion = Object.freeze({ begin, finish, refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
})();

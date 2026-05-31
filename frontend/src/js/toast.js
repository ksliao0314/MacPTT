// MacPTT — a tiny bottom-center toast for transient notices.

let _el = null;
let _timer = null;

export function toast(text, ms) {
  if (typeof document === 'undefined') return;
  if (!_el) {
    _el = document.createElement('div');
    const s = _el.style;
    s.position = 'fixed';
    s.left = '50%';
    s.bottom = '44px';
    s.transform = 'translateX(-50%)';
    s.zIndex = '2147483647';
    s.maxWidth = '80%';
    s.background = 'rgba(0,0,0,.85)';
    s.color = '#fff';
    s.font = '14px -apple-system, sans-serif';
    s.padding = '10px 16px';
    s.borderRadius = '8px';
    s.pointerEvents = 'none';
    s.textAlign = 'center';
    s.boxShadow = '0 4px 16px rgba(0,0,0,.4)';
    document.body.appendChild(_el);
  }
  _el.textContent = text;
  _el.style.display = 'block';
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(function() {
    if (_el) _el.style.display = 'none';
  }, ms || 2600);
}

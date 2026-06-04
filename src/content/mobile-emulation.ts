// MAIN world / document_start で navigator.* をモバイル値へ上書きし、
// ページ内JSのスマホ判定を成立させる。
// 注意: MOBILE_UA は rules/mobile-ua-rules.json の値と一致させること（手動同期）。

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function defineNavigatorProp(prop: string, value: unknown): void {
  try {
    Object.defineProperty(navigator, prop, {
      get: () => value,
      configurable: true,
    });
  } catch (e) {
    console.log('[Sidescribe] navigator override failed:', prop, e);
  }
}

defineNavigatorProp('userAgent', MOBILE_UA);
defineNavigatorProp('platform', 'iPhone');
defineNavigatorProp('maxTouchPoints', 5);
defineNavigatorProp('vendor', 'Apple Computer, Inc.');
defineNavigatorProp('userAgentData', undefined);

console.log('[Sidescribe] Mobile navigator override applied');

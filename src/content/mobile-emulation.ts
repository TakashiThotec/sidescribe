// navigator.* をモバイル値へ上書きし、ページ内JSのスマホ判定を成立させる。
// manifest で world:MAIN かつ run_at:document_start で注入されるため、
// ページ自身のスクリプトより先に実行され、上書きが確実に効く（両指定が必須）。
// 注意: MOBILE_UA は rules/mobile-ua-rules.json の値と一致させること（手動同期）。

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function defineNavigatorProp(prop: string, value: unknown): void {
  try {
    // enumerable: true でネイティブgetterと同じ見え方にする
    Object.defineProperty(navigator, prop, {
      get: () => value,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    console.log('[Sidescribe] navigator override failed:', prop, e);
  }
}

defineNavigatorProp('userAgent', MOBILE_UA);
defineNavigatorProp('platform', 'iPhone');
defineNavigatorProp('maxTouchPoints', 5);
defineNavigatorProp('vendor', 'Apple Computer, Inc.');
// 実機のiOS SafariはUA Client Hints未実装で navigator.userAgentData は undefined。
// よって undefined を返すのが正確な偽装（desktop値が漏れるのを防ぐ）。
defineNavigatorProp('userAgentData', undefined);

console.log('[Sidescribe] Mobile navigator override applied');

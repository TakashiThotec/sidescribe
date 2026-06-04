// 対象ドメインのタブを開いたらウィンドウをスマホ縦横比にリサイズし、
// 離脱時に元のサイズへ復元する。

const TARGET_HOSTNAME = 'tokyo-calendar-date.jp';
const TARGET_WIDTH = 430;   // ウィンドウ全体の幅（視覚テスト後に調整）
const TARGET_HEIGHT = 860;  // ウィンドウ全体の高さ（視覚テスト後に調整）
const STORAGE_KEY_PREFIX = 'mobileWindowOriginalBounds:';

interface WindowBounds {
  width: number;
  height: number;
  left: number;
  top: number;
}

// リサイズ処理中のウィンドウID。onUpdatedはloading/completeで複数回発火するため、
// storage書き込み完了前に2回目が走ると元サイズを上書きで失う。同期的に検査する
// メモリ上のロックで多重実行を防ぐ（SW再起動時はstorageの保存有無で判定される）。
const pendingResize = new Set<number>();

export function isMobileTargetUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === TARGET_HOSTNAME;
  } catch {
    return false;
  }
}

async function getStoredBounds(windowId: number): Promise<WindowBounds | null> {
  const key = STORAGE_KEY_PREFIX + windowId;
  const result = await chrome.storage.session.get(key);
  return (result[key] as WindowBounds) ?? null;
}

async function storeBounds(windowId: number, bounds: WindowBounds): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY_PREFIX + windowId]: bounds });
}

async function clearStoredBounds(windowId: number): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEY_PREFIX + windowId);
}

async function resizeToMobile(windowId: number): Promise<void> {
  // 多重実行ガード（同期的に検査・登録してから最初のawaitへ）
  if (pendingResize.has(windowId)) return;
  pendingResize.add(windowId);
  try {
    // すでに適用済み（元サイズ保存済み）なら何もしない
    const existing = await getStoredBounds(windowId);
    if (existing) return;

    const win = await chrome.windows.get(windowId);
    // 通常ウィンドウ以外（popup/devtools等）はリサイズしない
    if (win.type !== 'normal') return;
    if (win.width == null || win.height == null || win.left == null || win.top == null) {
      return;
    }

    await storeBounds(windowId, {
      width: win.width,
      height: win.height,
      left: win.left,
      top: win.top,
    });

    await chrome.windows.update(windowId, {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
    });
    console.log('[Sidescribe] Resized window to mobile:', windowId);
  } catch (e) {
    console.log('[Sidescribe] resizeToMobile failed:', e);
  } finally {
    pendingResize.delete(windowId);
  }
}

async function restoreWindow(windowId: number): Promise<void> {
  try {
    const bounds = await getStoredBounds(windowId);
    if (!bounds) return;
    await chrome.windows.update(windowId, {
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
    });
    await clearStoredBounds(windowId);
    console.log('[Sidescribe] Restored window size:', windowId);
  } catch (e) {
    console.log('[Sidescribe] restoreWindow failed:', e);
  }
}

// 対象ウィンドウ内に対象タブが他に残っていなければ復元する
async function maybeRestoreWindow(windowId: number): Promise<void> {
  try {
    // 復元すべき保存が無ければ即終了（通常タブ切替の無駄なクエリを避ける）
    if (!(await getStoredBounds(windowId))) return;
    const tabs = await chrome.tabs.query({ windowId });
    const stillHasTarget = tabs.some((t) => isMobileTargetUrl(t.url));
    if (!stillHasTarget) {
      await restoreWindow(windowId);
    }
  } catch (e) {
    console.log('[Sidescribe] maybeRestoreWindow failed:', e);
  }
}

export function registerMobileWindowListeners(): void {
  // タブのURL更新・読込状態を監視
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.windowId == null) return;
    if (isMobileTargetUrl(tab.url)) {
      resizeToMobile(tab.windowId);
    } else if (changeInfo.url || changeInfo.status === 'complete') {
      // 対象タブが対象外URLへ遷移した（SPA遷移でchangeInfo.url無しのケースも拾う）
      maybeRestoreWindow(tab.windowId);
    }
  });

  // タブ切替を監視
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isMobileTargetUrl(tab.url)) {
        resizeToMobile(windowId);
      } else {
        maybeRestoreWindow(windowId);
      }
    } catch (e) {
      console.log('[Sidescribe] onActivated handler failed:', e);
    }
  });

  // タブが閉じられたとき（ウィンドウごと閉じる場合は除く）
  chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) {
      maybeRestoreWindow(removeInfo.windowId);
    }
  });

  // ウィンドウが閉じられたら保存をクリーンアップ
  chrome.windows.onRemoved.addListener((windowId) => {
    clearStoredBounds(windowId);
  });
}

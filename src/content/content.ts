import { Message, SuicaTransaction, BankTransaction, CardBilling } from '../types';

// ── X/Twitter: タブ操作 ──
const isXSite = window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com';

// Xのタイムラインタブ要素を探す汎用関数
function findXTimelineTabs(): { forYou: HTMLElement | null; following: HTMLElement | null; all: { text: string; tag: string; el: HTMLElement }[] } {
  let forYou: HTMLElement | null = null;
  let following: HTMLElement | null = null;
  const all: { text: string; tag: string; el: HTMLElement }[] = [];

  // 候補セレクタを順番に試す
  const selectors = [
    '[role="tab"]',
    '[role="tablist"] a',
    '[data-testid="ScrollSnap-List"] a',
    'nav [role="presentation"] a',
  ];

  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const text = el.textContent?.trim() || '';
      all.push({ text, tag: el.tagName, el });
      if (text === 'おすすめ' || text === 'For you') forYou = el;
      if (text === 'フォロー中' || text === 'Following') following = el;
    });
    if (forYou || following) break;
  }

  return { forYou, following, all };
}

function getXTabStatus() {
  const { forYou, following, all } = findXTimelineTabs();
  const forYouHidden = forYou ? forYou.style.display === 'none' : false;
  // aria-selected で現在のアクティブタブを判定
  const activeTab = all.find((t) => t.el.getAttribute('aria-selected') === 'true')?.text || 'unknown';
  return {
    forYouFound: !!forYou,
    followingFound: !!following,
    forYouHidden,
    activeTab,
    allTabs: all.map((t) => ({ text: t.text, tag: t.tag })),
  };
}

function xSwitchToFollowing(): { success: boolean; message: string } {
  const { following } = findXTimelineTabs();
  if (!following) return { success: false, message: '「フォロー中」タブが見つかりません' };
  following.click();
  return { success: true, message: '「フォロー中」に切り替えました' };
}

function xSwitchToForYou(): { success: boolean; message: string } {
  const { forYou } = findXTimelineTabs();
  if (!forYou) return { success: false, message: '「おすすめ」タブが見つかりません' };
  // 非表示を解除してクリック
  forYou.style.display = '';
  forYou.click();
  return { success: true, message: '「おすすめ」に切り替えました' };
}

function xHideForYouTab(): { success: boolean; message: string } {
  const { forYou, following } = findXTimelineTabs();
  if (!forYou) return { success: false, message: '「おすすめ」タブが見つかりません' };

  // まずフォロー中に切り替え
  if (following) {
    const isForYouActive = forYou.getAttribute('aria-selected') === 'true';
    if (isForYouActive) following.click();
  }

  // おすすめを非表示
  forYou.style.display = 'none';
  return { success: true, message: '「おすすめ」を非表示にしました' };
}

// 自動実行: ページ読み込み時にフォロー中へ切り替え＋おすすめ非表示
if (isXSite) {
  let switched = false;
  const autoSwitch = () => {
    const { forYou, following } = findXTimelineTabs();
    if (following && !switched) {
      const isForYouActive = forYou?.getAttribute('aria-selected') === 'true';
      if (isForYouActive) {
        following.click();
        console.log('[Sidescribe] 「フォロー中」に自動切り替え');
      }
      if (forYou) forYou.style.display = 'none';
      switched = true;
    }
  };

  autoSwitch();
  const observer = new MutationObserver(() => {
    autoSwitch();
    hideXAds();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── X/Twitter: 広告を非表示 ──
function hideXAds() {
  document.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]').forEach((cell) => {
    if (cell.dataset.sidescribeChecked) return;
    cell.dataset.sidescribeChecked = 'true';

    // 方法1: placementTracking（動画広告等）
    if (cell.querySelector('[data-testid="placementTracking"]')) {
      cell.style.display = 'none';
      console.log('[Sidescribe] Ad hidden (placementTracking)');
      return;
    }

    // 方法2: 「広告」「プロモーション」「Ad」「Promoted」ラベル
    const spans = cell.querySelectorAll('span');
    for (const span of spans) {
      const t = span.textContent?.trim();
      if (t === '広告' || t === 'Ad' || t === 'プロモーション' || t === 'Promoted') {
        cell.style.display = 'none';
        console.log('[Sidescribe] Ad hidden:', t);
        return;
      }
    }

    // 方法3: おすすめユーザー
    if (cell.querySelector('a[href*="/i/connect_people"]')) {
      cell.style.display = 'none';
      console.log('[Sidescribe] "Who to follow" hidden');
    }
  });
}

// ── メッセージリスナー ──
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.action) {
    case 'PING':
      sendResponse({ success: true });
      break;

    case 'EXTRACT_BANK_DATA':
      sendResponse(extractBankData());
      break;

    case 'EXTRACT_CARD_DATA':
      sendResponse(extractCardData());
      break;

    // Suica
    case 'GET_SUICA_DATA':
      sendResponse(getSuicaData());
      break;

    // Card Billing
    case 'GET_CARD_BILLING':
      sendResponse(getCardBilling());
      break;

    // X/Twitter
    case 'X_GET_STATUS':
      sendResponse({ success: true, data: getXTabStatus() });
      break;

    case 'X_HIDE_FOR_YOU':
      sendResponse({ success: true, data: xHideForYouTab() });
      break;

    case 'X_SWITCH_TO_FOR_YOU':
      sendResponse({ success: true, data: xSwitchToForYou() });
      break;

    case 'X_SWITCH_TO_FOLLOWING':
      sendResponse({ success: true, data: xSwitchToFollowing() });
      break;

    default:
      sendResponse({ error: `Unknown content action: ${message.action}` });
  }
  return true;
});

// ── 住信SBIネット銀行 ──
function extractBankData(): { success: boolean; data: BankTransaction[]; period?: string; error?: string } {
  const hostname = window.location.hostname;
  if (!hostname.includes('netbk.co.jp')) {
    return { success: false, data: [], error: 'Not on SBI Net Bank page' };
  }

  const transactions: BankTransaction[] = [];

  try {
    // 期間情報を取得 (例: "2026年1月")
    const periodElement = document.querySelector('.details-title h2');
    const period = periodElement?.textContent?.trim() || '';

    // 明細アイテムを取得
    const detailsItems = document.querySelectorAll('.details-items .details-item');

    if (detailsItems.length === 0) {
      return { success: false, data: [], period, error: '明細データが見つかりませんでした' };
    }

    detailsItems.forEach((item, index) => {
      try {
        // 日付を取得 (datetime属性からYYYY-MM-DD形式)
        const timeElement = item.querySelector('time.details-item-date');
        const dateStr = timeElement?.getAttribute('datetime') || '';
        if (!dateStr) return;

        // 取引内容を取得 (PC表示用のspan.pc)
        const descElement = item.querySelector('.details-item-summary span.pc');
        const description = descElement?.textContent?.trim() || '';

        // 出金金額を取得
        let withdrawal: number | undefined;
        const withdrawalElement = item.querySelector('._whdrwl .details-amt ._num');
        if (withdrawalElement) {
          const withdrawalText = withdrawalElement.textContent?.trim() || '';
          // 「-181,379」形式から数値を抽出
          const withdrawalNum = parseInt(withdrawalText.replace(/[^\d]/g, ''), 10);
          if (!isNaN(withdrawalNum) && withdrawalNum > 0) {
            withdrawal = withdrawalNum;
          }
        }

        // 入金金額を取得
        let deposit: number | undefined;
        const depositElement = item.querySelector('._dpst .details-amt ._num');
        if (depositElement) {
          const depositText = depositElement.textContent?.trim() || '';
          // 「+1,000,000」形式から数値を抽出
          const depositNum = parseInt(depositText.replace(/[^\d]/g, ''), 10);
          if (!isNaN(depositNum) && depositNum > 0) {
            deposit = depositNum;
          }
        }

        // 入金も出金もない場合はスキップ
        if (withdrawal === undefined && deposit === undefined) {
          return;
        }

        // 残高を取得
        let balance: number | undefined;
        const balanceElement = item.querySelector('.details-item-balance .details-amt ._num');
        if (balanceElement) {
          // 残高は複数のspan要素に分かれている場合があるので、数値部分のみ取得
          const balanceSpan = balanceElement.querySelector('span[data-msta-ignore]') || balanceElement;
          const balanceText = balanceSpan.textContent?.trim() || '';
          const balanceNum = parseInt(balanceText.replace(/[^\d]/g, ''), 10);
          if (!isNaN(balanceNum)) {
            balance = balanceNum;
          }
        }

        // メモを取得
        const memoElement = item.querySelector('.details-item-memo .m-txt');
        const memo = memoElement?.textContent?.trim() || undefined;

        transactions.push({
          date: dateStr,
          description,
          withdrawal,
          deposit,
          balance,
          memo: memo && memo.length > 0 ? memo : undefined,
        });
      } catch (err) {
        console.error('[Sidescribe] Error processing bank transaction item:', err);
      }
    });

    return { success: true, data: transactions, period };
  } catch (err) {
    console.error('[Sidescribe] Error extracting bank data:', err);
    return { success: false, data: [], error: String(err) };
  }
}

// ── カード明細 ──
function extractCardData() {
  // TODO: 各カード会社ごとの抽出ロジックを実装
  return { data: [], message: 'Card extraction not yet implemented' };
}

// ── Suica履歴を取得 ──
function getSuicaData(): { success: boolean; data: SuicaTransaction[]; error?: string } {
  const hostname = window.location.hostname;
  if (!hostname.includes('jreast.co.jp') && !hostname.includes('mobilesuica.com')) {
    return { success: false, data: [], error: 'Not on Suica history page' };
  }

  const transactions: SuicaTransaction[] = [];

  try {
    // 年月selectの取得
    const ymSelect = document.querySelector('select[name="specifyYearMonth"]') as HTMLSelectElement | null;
    const ym = ymSelect?.value || '';

    if (!ym) {
      return { success: false, data: [], error: '年月選択が見つかりませんでした' };
    }

    const [currentYear, currentMonth] = ym.split('/').map(Number);

    if (isNaN(currentYear) || isNaN(currentMonth)) {
      return { success: false, data: [], error: '年月の形式が正しくありません' };
    }

    // テーブルの特定
    const tables = document.querySelectorAll('td.historyTable table');
    let targetTable: HTMLTableElement | null = null;

    for (const table of Array.from(tables)) {
      const rows = table.querySelectorAll('tr');
      if (rows.length > 1) {
        const headerRow = rows[0];
        const headerCells = headerRow.querySelectorAll('td');
        if (headerCells.length >= 8) {
          targetTable = table as HTMLTableElement;
          break;
        }
      }
    }

    if (!targetTable) {
      return { success: false, data: [], error: '利用履歴テーブルが見つかりませんでした' };
    }

    const rows = Array.from(targetTable.querySelectorAll('tr')).slice(1); // ヘッダーをスキップ
    let prevMonth = currentMonth;
    let year = currentYear;

    rows.forEach((tr, index) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 8) return;

      // MM/DD形式の日付を取得（2列目）
      const mmdd = tds[1]?.textContent?.trim() || '';
      if (!mmdd) return;

      const [mm, dd] = mmdd.split('/').map(Number);
      if (isNaN(mm) || isNaN(dd)) return;

      // 年をまたぐ場合の処理
      if (mm > prevMonth) {
        year--;
      }
      prevMonth = mm;

      // YYYY-MM-DD形式に変換
      const dateStr = `${year.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;

      // チャージ・利用額を取得（8列目）
      const amountStr = tds[7]?.textContent?.trim().replace(/[,￥\\]/g, '') || '';
      const amount = parseInt(amountStr, 10);
      if (isNaN(amount) || amount === 0) return; // 0円は無視

      // 残高を取得（7列目）
      const balanceStr = tds[6]?.textContent?.trim().replace(/[,￥\\]/g, '') || '';

      // 取引内容（種別、利用駅、出入区分、相手駅をスペース区切り）
      const details = [
        tds[2]?.textContent?.trim() || '', // 種別
        tds[3]?.textContent?.trim() || '', // 利用場所1
        tds[4]?.textContent?.trim() || '', // 入/出
        tds[5]?.textContent?.trim() || '', // 利用場所2
      ]
        .filter((v) => v !== '')
        .join(' ');

      transactions.push({
        date: dateStr,
        amount: amount,
        details: details,
        balance: balanceStr,
      });
    });

    return { success: true, data: transactions };
  } catch (err) {
    console.error('[Sidescribe] Error getting Suica data:', err);
    return { success: false, data: [], error: String(err) };
  }
}

// ── カード引き落とし額を取得 ──
function getCardBilling(): { success: boolean; data: CardBilling[]; error?: string } {
  const hostname = window.location.hostname;
  
  // Amex
  if (hostname.includes('americanexpress.com')) {
    return getAmexBilling();
  }
  
  // SMBC
  if (hostname.includes('smbc-card.com')) {
    return getSmbcBilling();
  }
  
  return { success: false, data: [], error: 'Not on supported card company page' };
}

// ── Amex引き落とし額を取得 ──
function getAmexBilling(): { success: boolean; data: CardBilling[]; error?: string } {
  const billings: CardBilling[] = [];
  
  try {
    // 方法1: data-locator-id属性を使用（Amex公式の属性）
    // schedule_payment_title_amount に金額がある
    const amountElements = document.querySelectorAll('[data-locator-id="schedule_payment_title_amount"]');
    const titleElements = document.querySelectorAll('[data-locator-id="schedule_payment_title"]');
    
    console.log('[Sidescribe] Amex amount elements found:', amountElements.length);
    console.log('[Sidescribe] Amex title elements found:', titleElements.length);
    
    amountElements.forEach((amountEl, index) => {
      try {
        // 金額を取得（例: "¥197,967"）
        const amountText = amountEl.textContent?.trim() || '';
        const amountMatch = amountText.match(/[¥￥]\s?([\d,]+)/);
        const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : 0;
        
        // 支払い日を取得（対応するtitle要素から）
        let paymentDate = '';
        if (titleElements[index]) {
          const titleText = titleElements[index].textContent?.trim() || '';
          const dateMatch = titleText.match(/(\d{1,2}月\d{1,2}日)/);
          paymentDate = dateMatch ? dateMatch[1] : '';
        }
        
        // カード名を探す（親要素を遡って、カードセクション全体を見つける）
        let cardName = 'American Express';
        let parentEl = amountEl.parentElement;
        
        for (let i = 0; i < 20 && parentEl; i++) {
          // h1, h2, h3 または特定のクラスでカード名を探す
          const cardNameEl = parentEl.querySelector('h1, h2, h3, [class*="card-product"], [class*="heading-sans"]');
          if (cardNameEl) {
            const candidateName = cardNameEl.textContent?.trim() || '';
            // カード名っぽいかチェック（「カード」を含む、または英語のカード名）
            if (candidateName.includes('カード') || /Card/i.test(candidateName) || /MARRIOTT|BONVOY|ANA|DELTA|HILTON|SPG/i.test(candidateName)) {
              // 番号部分を除去（例: "・・・・62006"）
              cardName = candidateName.replace(/[・･]{2,}\d+/g, '').replace(/®/g, '').trim();
              break;
            }
          }
          parentEl = parentEl.parentElement;
        }
        
        if (amount > 0) {
          // 重複チェック
          const isDuplicate = billings.some(
            b => b.amount === amount && b.paymentDate === paymentDate
          );
          
          if (!isDuplicate) {
            billings.push({
              cardCompany: 'amex',
              cardName: cardName,
              paymentDate: paymentDate,
              amount: amount,
              isConfirmed: true,
              fetchedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error('[Sidescribe] Error processing Amex amount element:', err);
      }
    });
    
    // 方法2: data-locator-idで見つからない場合のフォールバック
    if (billings.length === 0) {
      // テキストベースで「お支払い金額」を探す
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim() || '';
        if (text.includes('お支払い金額')) {
          // 支払い日を抽出
          const dateMatch = text.match(/(\d{1,2}月\d{1,2}日)/);
          const paymentDate = dateMatch ? dateMatch[1] : '';
          
          // 親要素から金額を探す
          let parentEl = node.parentElement;
          for (let i = 0; i < 10 && parentEl; i++) {
            const parentText = parentEl.textContent || '';
            const amountMatch = parentText.match(/[¥￥]\s?([\d,]+)/);
            if (amountMatch) {
              const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
              if (amount > 100 && amount < 100000000) {
                const isDuplicate = billings.some(b => b.amount === amount);
                if (!isDuplicate) {
                  billings.push({
                    cardCompany: 'amex',
                    cardName: 'American Express',
                    paymentDate: paymentDate,
                    amount: amount,
                    isConfirmed: true,
                    fetchedAt: new Date().toISOString(),
                  });
                }
                break;
              }
            }
            parentEl = parentEl.parentElement;
          }
        }
      }
    }
    
    console.log('[Sidescribe] Amex billings found:', billings);
    return { success: true, data: billings };
  } catch (err) {
    console.error('[Sidescribe] Error getting Amex billing:', err);
    return { success: false, data: [], error: String(err) };
  }
}

// ── SMBC引き落とし額を取得 ──
function getSmbcBilling(): { success: boolean; data: CardBilling[]; error?: string } {
  const billings: CardBilling[] = [];
  
  try {
    // メインのお支払い金額セクション (MypageInquiryCardBox)
    const paymentBoxes = document.querySelectorAll('.MypageInquiryCardBoxMoney, .MypageInquiryCardBox');
    
    paymentBoxes.forEach((box, index) => {
      try {
        // タイトル行から支払い日を取得
        const titleEl = box.querySelector('.MypageInquiryCardBoxTitle');
        const titleText = titleEl?.textContent || '';
        
        // 「お支払い金額」が含まれているかチェック
        if (!titleText.includes('お支払い金額')) return;
        
        // 支払い日を抽出（例: "2月26日"）
        const dateMatch = titleText.match(/(\d{1,2}月\d{1,2}日)/);
        const paymentDate = dateMatch ? dateMatch[1] : '';
        
        // 確定状態を確認
        const isConfirmed = !titleText.includes('未確定');
        
        // 金額を取得（MypageVariousMoney内）
        const amountEl = box.querySelector('.MypageVariousMoney');
        const amountText = amountEl?.textContent?.replace(/[^\d]/g, '') || '';
        const amount = parseInt(amountText, 10);
        
        if (amount > 0) {
          billings.push({
            cardCompany: 'smbc',
            cardName: '三井住友カード',
            paymentDate: paymentDate,
            amount: amount,
            isConfirmed: isConfirmed,
            fetchedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[Sidescribe] Error processing SMBC payment box:', err);
      }
    });
    
    // 代替: vp_alcor_view_Label要素から取得を試みる
    if (billings.length === 0) {
      const labelElements = document.querySelectorAll('[widgetid^="vp_alcor_view_Label"]');
      let paymentDate = '';
      let amount = 0;
      
      labelElements.forEach((el) => {
        const text = el.textContent?.trim() || '';
        // 日付パターン（例: "2月26日"）
        if (/\d{1,2}月\d{1,2}日/.test(text)) {
          paymentDate = text;
        }
        // 金額パターン（数字のみ、カンマ含む）
        if (/^[\d,]+$/.test(text.replace(/,/g, ''))) {
          const num = parseInt(text.replace(/,/g, ''), 10);
          if (num > 100 && num < 10000000) {
            amount = num;
          }
        }
      });
      
      if (amount > 0) {
        billings.push({
          cardCompany: 'smbc',
          cardName: '三井住友カード',
          paymentDate: paymentDate,
          amount: amount,
          isConfirmed: true,
          fetchedAt: new Date().toISOString(),
        });
      }
    }
    
    return { success: true, data: billings };
  } catch (err) {
    console.error('[Sidescribe] Error getting SMBC billing:', err);
    return { success: false, data: [], error: String(err) };
  }
}

console.log('[Sidescribe] Content script loaded on:', window.location.hostname);

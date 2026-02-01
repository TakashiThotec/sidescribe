import { Message, GabaLesson, SuicaTransaction, BankTransaction, CardBilling } from '../types';

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

    // Gaba
    case 'GET_GABA_RESERVATIONS':
      sendResponse(getGabaReservations());
      break;

    case 'GET_GABA_COMPLETED':
      sendResponse(getGabaCompletedLessons());
      break;

    // Suica
    case 'GET_SUICA_DATA':
      sendResponse(getSuicaData());
      break;

    // Card Billing
    case 'GET_CARD_BILLING':
      sendResponse(getCardBilling());
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

// ── Gaba予約情報を取得 ──
function getGabaReservations(): { success: boolean; data: GabaLesson[]; error?: string } {
  const hostname = window.location.hostname;
  if (!hostname.includes('my.gaba.jp')) {
    return { success: false, data: [], error: 'Not on Gaba MyPage' };
  }

  const reservations: GabaLesson[] = [];

  try {
    // 全てのmod-schedule-list要素を探す
    const scheduleLists = document.querySelectorAll('.mod-schedule-list');

    scheduleLists.forEach((scheduleList, listIndex) => {
      // このリスト内の予約項目を取得
      const items = scheduleList.querySelectorAll('ul.list li.row');

      items.forEach((item, index) => {
        try {
          // 日付を取得
          const dateElement = item.querySelector('.date .text .ymd');
          const dateText = dateElement ? dateElement.textContent?.trim() || '' : '';

          // 時間を取得
          const timeElement = item.querySelector('.date .text .time');
          const timeText = timeElement ? timeElement.textContent?.trim() || '' : '';

          // LS情報を取得
          const lsElement = item.querySelector('.date .ls');
          const lsText = lsElement ? lsElement.textContent?.trim() || '' : '';

          // 有効なデータがある場合のみ追加
          if (dateText && timeText) {
            // 日付を解析して今日以降かチェック
            const dateMatch = dateText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
            if (dateMatch) {
              const year = parseInt(dateMatch[1]);
              const month = parseInt(dateMatch[2]) - 1; // 月は0から始まる
              const day = parseInt(dateMatch[3]);
              const reservationDate = new Date(year, month, day);
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              // 今日以降の予約のみ追加
              if (reservationDate >= today) {
                reservations.push({
                  id: `reservation-${listIndex}-${index}`,
                  date: dateText,
                  time: timeText,
                  ls: lsText,
                  status: 'reserved',
                });
              }
            }
          }
        } catch (err) {
          console.error('[Sidescribe] Error processing Gaba reservation item:', err);
        }
      });
    });

    return { success: true, data: reservations };
  } catch (err) {
    console.error('[Sidescribe] Error getting Gaba reservations:', err);
    return { success: false, data: [], error: String(err) };
  }
}

// ── Gaba終了済みレッスンを取得 ──
function getGabaCompletedLessons(): { success: boolean; data: GabaLesson[]; error?: string } {
  const hostname = window.location.hostname;
  if (!hostname.includes('my.gaba.jp')) {
    return { success: false, data: [], error: 'Not on Gaba MyPage' };
  }

  const completedLessons: GabaLesson[] = [];

  try {
    // 全てのmod-schedule-list要素を探す
    const scheduleLists = document.querySelectorAll('.mod-schedule-list');

    // 2番目以降のmod-schedule-list（終了済みレッスン）を処理
    for (let listIndex = 1; listIndex < scheduleLists.length; listIndex++) {
      const scheduleList = scheduleLists[listIndex];

      // このリスト内の終了済みレッスン項目を取得
      const items = scheduleList.querySelectorAll('ul.list li.row');

      items.forEach((item, index) => {
        try {
          // 日付を取得
          const dateElement = item.querySelector('.date .text .ymd');
          const dateText = dateElement ? dateElement.textContent?.trim() || '' : '';

          // 時間を取得
          const timeElement = item.querySelector('.date .text .time');
          const timeText = timeElement ? timeElement.textContent?.trim() || '' : '';

          // LS情報を取得
          const lsElement = item.querySelector('.date .ls');
          const lsText = lsElement ? lsElement.textContent?.trim() || '' : '';

          // 有効なデータがある場合のみ追加
          if (dateText && timeText) {
            completedLessons.push({
              id: `completed-${listIndex}-${index}`,
              date: dateText,
              time: timeText,
              ls: lsText,
              status: 'completed',
            });
          }
        } catch (err) {
          console.error('[Sidescribe] Error processing Gaba completed lesson item:', err);
        }
      });
    }

    return { success: true, data: completedLessons };
  } catch (err) {
    console.error('[Sidescribe] Error getting Gaba completed lessons:', err);
    return { success: false, data: [], error: String(err) };
  }
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

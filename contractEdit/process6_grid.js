const { smartClick } = require("../utils/click");

/**
 * [test6.js] 최종 [입력] 버튼 클릭 및 저장
 * @param {import('puppeteer').Page} page
 */
async function finalizeInput(page) {
  console.log("💾 [test6.js] 최종 [입력] 버튼 클릭을 시도합니다...");

  // 1. 버튼이 포함된 프레임 찾기 (npia115p01 또는 winNPA03020000 포함)
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("winNPA03020000") || f.name().includes("npia115p01")
  );

  // 프레임 이름으로 못 찾을 경우 요소를 직접 탐색
  if (!workFrame) {
    for (const frame of frames) {
      try {
        const hasBtn = await frame.$('div[id*="btn_choice"]');
        if (hasBtn) {
          workFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  if (!workFrame)
    return console.error("❌ [입력] 버튼이 있는 프레임을 찾을 수 없습니다.");

  try {
    // 2. 버튼 셀렉터 (ID의 끝부분과 텍스트 '입력' 활용)
    const submitBtnSelector =
      'xpath///div[contains(@id, "btn_choice")]//div[text()="입력"]';

    await workFrame.waitForSelector(submitBtnSelector, { timeout: 5000 });
    const submitBtn = await workFrame.$(submitBtnSelector);

    if (submitBtn) {
      console.log("🖱️ [입력] 버튼 발견! 클릭합니다.");
      await smartClick(page, workFrame, submitBtn);

      // 클릭 후 서버 처리 및 알림창(Alert) 대기 시간
      console.log("⏳ 데이터 저장 중... (2초 대기)");
      await new Promise((r) => setTimeout(r, 2000));

      console.log("✅ [test6.js] 입력 버튼 클릭 프로세스 종료.");
    } else {
      console.error("❌ [입력] 버튼 요소를 찾을 수 없습니다.");
    }
  } catch (err) {
    console.error("❌ test6.js 실행 중 오류:", err.message);
  }
}

module.exports = { finalizeInput };

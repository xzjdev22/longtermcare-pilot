const { smartClick } = require("../utils/click");
const { selectComboByText } = require("../utils/combo");

async function fillRegistrationDetails(page) {
  console.log("📂 [등록 팝업] 상세 데이터 입력을 시작합니다... (test2.js)");

  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("framesetWork") || f.name().includes("winNPA03020000")
  );

  if (!workFrame) {
    for (const frame of frames) {
      try {
        if (await frame.$('xpath///div[contains(@id, "npia107p01")]')) {
          workFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  if (!workFrame)
    return console.error("❌ 메인 작업 프레임을 찾을 수 없습니다.");

  try {
    // ---------------------------------------------------------
    // [STEP 1] 년월 설정 (모듈화 버전 호출)
    // ---------------------------------------------------------
    await selectComboByText(page, workFrame, "cmb_ctrYm", "2026년 4월");

    // ---------------------------------------------------------
    // [STEP 2] 조회 버튼 클릭
    // ---------------------------------------------------------
    console.log("🔍 [조회] 버튼 클릭 시도...");
    const searchBtnSelector =
      'xpath///div[contains(@id, "npia107p01")]//div[contains(@id, "btn_select")]';
    const searchBtn = await workFrame.$(searchBtnSelector);

    if (searchBtn) {
      await smartClick(page, workFrame, searchBtn);
      console.log("✅ 조회 완료. 데이터 로딩 대기...");
      await new Promise((r) => setTimeout(r, 2500));
    }

    // ---------------------------------------------------------
    // [STEP 3] 입력(행 추가) 버튼 클릭
    // ---------------------------------------------------------
    console.log("📝 [입력] 버튼 클릭 시도...");
    const addBtnSelector =
      'xpath///div[contains(@id, "btn_addRow")]//div[text()="입력"]';
    try {
      await workFrame.waitForSelector(addBtnSelector, { timeout: 5000 });
      const addBtn = await workFrame.$(addBtnSelector);
      if (addBtn) {
        await smartClick(page, workFrame, addBtn);
        console.log("✅ [입력] 버튼 클릭 성공");
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (btnErr) {
      console.error("❌ [입력] 버튼을 찾을 수 없습니다.");
    }
  } catch (err) {
    console.error("❌ test2.js 실행 중 오류:", err.message);
  }
}

module.exports = { fillRegistrationDetails };

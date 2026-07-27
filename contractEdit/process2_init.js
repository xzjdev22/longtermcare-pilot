const { smartClick } = require("../utils/click");
const { selectComboByText } = require("../utils/combo");

async function fillRegistrationDetails(page) {
  console.log("📂 [Phase A] 년월 설정 및 조회 프로세스를 시작합니다...");

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
  // ------------------------------

  try {
    // [STEP 1] 년월 설정 (2026년 4월)
    await selectComboByText(page, workFrame, "cmb_ctrYm", "2026년 8월");

    // [STEP 2] 조회 버튼 클릭
    console.log("🔍 [조회] 버튼 클릭 시도...");
    const searchBtnSelector =
      'xpath///div[contains(@id, "npia107p01")]//div[contains(@id, "btn_select")]';
    const searchBtn = await workFrame.$(searchBtnSelector);

    if (searchBtn) {
      await smartClick(page, workFrame, searchBtn);
      console.log("✅ 조회 완료. 데이터 로딩 대기 (2.5초)...");
      await new Promise((r) => setTimeout(r, 2500));
    }
  } catch (err) {
    console.error("❌ process2_init.js 실행 중 오류:", err.message);
  }
}

module.exports = { fillRegistrationDetails };

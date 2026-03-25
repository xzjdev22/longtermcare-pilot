const { selectComboByText } = require("../utils/combo");

/**
 * [test5.js] 서비스 방법 콤보박스 자동 선택
 */
async function selectComboItem(page) {
  const targetText = "방문목욕 차량을 이용한 경우(차량내 목욕) 60분이상";
  console.log(`📂 [test5.js] 서비스 방법 자동 설정 시작: [${targetText}]`);

  // 1. 작업 프레임 특정 (그리드가 포함된 팝업 프레임)
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("winNPA03020000") || f.name().includes("npia115p01")
  );

  if (!workFrame) {
    for (const frame of frames) {
      try {
        if (await frame.$('div[id*="cmb_mech"]')) {
          workFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  if (!workFrame) {
    return console.error("❌ 콤보박스 프레임을 찾을 수 없습니다.");
  }

  try {
    // 2. 모듈화된 정밀 탐색 함수 호출 (CLI 확인 없이 1회 실행)
    const isOk = await selectComboByText(
      page,
      workFrame,
      "cmb_mech",
      targetText
    );

    if (isOk) {
      console.log(`✅ [test5.js] [${targetText}] 선택 완료.`);
      // 선택 후 시스템 반영을 위해 잠시 대기
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      console.error("❌ [test5.js] 항목을 찾지 못해 선택에 실패했습니다.");
    }
  } catch (err) {
    console.error("❌ test5.js 실행 중 오류:", err.message);
  }
}

module.exports = { selectComboItem };

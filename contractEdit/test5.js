const readline = require("readline");
const { selectComboByText } = require("../utils/combo");

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.toLowerCase());
    })
  );
}

/**
 * [test5.js] 서비스 방법 콤보박스 선택
 */
async function selectComboItem(page) {
  const targetText = "방문목욕 차량을 이용한 경우(차량내 목욕) 60분이상";
  console.log(`📂 [test5.js] 콤보박스 설정 시작: [${targetText}]`);

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

  if (!workFrame)
    return console.error("❌ 콤보박스 프레임을 찾을 수 없습니다.");

  try {
    let success = false;
    while (!success) {
      // 2. 모듈화된 정밀 탐색 함수 호출 (cmb_mech 대상)
      const isOk = await selectComboByText(
        page,
        workFrame,
        "cmb_mech",
        targetText
      );

      if (isOk) {
        const answer = await askQuestion(
          `❓ [${targetText}]가 올바르게 선택되었습니까? (y: 다음, n: 재시도): `
        );
        if (answer === "y") success = true;
      } else {
        console.log("❌ 항목을 찾지 못했습니다.");
        const retry = await askQuestion("❓ 다시 시도할까요? (y/n): ");
        if (retry !== "y") break;
      }
    }

    if (success) {
      console.log("✅ [test5.js] 서비스 방법 설정 완료.");
    }
  } catch (err) {
    console.error("❌ test5.js 실행 중 오류:", err.message);
  }
}

module.exports = { selectComboItem };

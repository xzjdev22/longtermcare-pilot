const { smartClick } = require("../utils/click");

/**
 * 모든 프레임을 순회하며 특정 셀렉터를 찾는 헬퍼
 */
async function findElementInAllFrames(page, selector) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const el = await frame.$(selector);
      if (el) return { frame, el };
    } catch (e) {
      continue;
    }
  }
  return { frame: null, el: null };
}

async function finalizeRegistration(page) {
  console.log("\n💾 [test8.js] 최종 [저장 및 통보] 프로세스 시작...");

  let dialogCount = 0;

  // [1] 다이얼로그 핸들러 등록
  page.on("dialog", async (dialog) => {
    dialogCount++;
    console.log(`\n-------------------------------------------`);
    console.log(`💬 [팝업 ${dialogCount}] 포착`);
    console.log(`📝 내용: ${dialog.message()}`);
    console.log(`-------------------------------------------`);

    // 🎯 팝업 내용을 읽을 수 있게 3초간 대기 후 클릭합니다.
    await new Promise((r) => setTimeout(r, 3000));

    await dialog.accept();
    console.log(`✅ [팝업 ${dialogCount}] 확인 클릭 완료.`);
  });

  try {
    // [2] 버튼 탐색
    const saveBtnSelector =
      'xpath///div[contains(@id, "btn_save")]//div[text()="저장 및 통보"]';
    const { frame: targetFrame, el: saveBtn } = await findElementInAllFrames(
      page,
      saveBtnSelector
    );

    if (saveBtn) {
      console.log("🎯 [저장 및 통보] 버튼 발견! 스마트 클릭 시도...");
      await smartClick(page, targetFrame, saveBtn);

      console.log("🚀 클릭 완료. 연속 팝업 대기 및 확인 중 (10초)...");

      // 팝업이 여러 개 뜨고 사람이 읽는 시간까지 고려하여 대기 시간을 10초로 늘렸습니다.
      await new Promise((r) => setTimeout(r, 10000));

      // [3] 최종 성공 판정 로직
      console.log("\n===========================================");
      if (dialogCount >= 2) {
        console.log("🎊 [최종 결과] 저장 시도 성공! (팝업 2회 이상 처리)");
      } else if (dialogCount === 1) {
        console.log("⚠️ [최종 결과] 확인 필요 (팝업이 1번만 발생함)");
      } else {
        console.log("❌ [최종 결과] 저장 실패 (팝업이 발생하지 않았습니다)");
      }
      console.log(`📊 처리된 총 팝업: ${dialogCount}개`);
      console.log("===========================================\n");
    } else {
      console.error("❌ [test8.js] 저장 버튼을 아예 찾지 못했습니다.");
    }
  } catch (err) {
    console.error("❌ [test8.js] 실행 중 예외 발생:", err.message);
  }

  console.log("🏁 [test8.js] 모든 공정 종료.");
}

module.exports = { finalizeRegistration };

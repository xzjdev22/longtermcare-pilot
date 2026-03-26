const { smartClick } = require("../utils/click");

async function finalizeRegistration(page) {
  console.log("\n💾 [test8.js] 최종 [저장 및 통보] 프로세스 시작...");

  let dialogCount = 0;
  let isSuccessConfirmed = false; // ✅ 실제 성공 키워드 확인 플래그

  // [1] 다이얼로그 핸들러 등록
  page.on("dialog", async (dialog) => {
    dialogCount++;
    const msg = dialog.message(); // 팝업 메시지 내용 추출

    console.log(`\n-------------------------------------------`);
    console.log(`💬 [팝업 ${dialogCount}] 포착`);
    console.log(`📝 내용: ${msg}`);
    console.log(`-------------------------------------------`);

    // ✅ 핵심 로직 추가: 메시지에 '완료' 또는 '성공'이 포함되어 있는지 체크
    if (msg.includes("완료") || msg.includes("성공")) {
      isSuccessConfirmed = true;
    }

    // 🎯 사용자가 내용을 확인할 수 있게 잠시 대기 후 클릭
    await new Promise((r) => setTimeout(r, 2000));
    await dialog.accept();
    console.log(`✅ [팝업 ${dialogCount}] 확인 클릭 완료.`);
  });

  try {
    // [2] 버튼 탐색 및 클릭 (기존 로직 유지)
    const saveBtnSelector =
      'xpath///div[contains(@id, "btn_save")]//div[text()="저장 및 통보"]';
    const frames = page.frames();
    let targetFrame = null;
    let saveBtn = null;

    // 모든 프레임에서 버튼 찾기
    for (const frame of frames) {
      saveBtn = await frame.$(saveBtnSelector);
      if (saveBtn) {
        targetFrame = frame;
        break;
      }
    }

    if (saveBtn) {
      console.log("🎯 [저장 및 통보] 버튼 발견! 클릭 시도...");
      await smartClick(page, targetFrame, saveBtn);

      console.log("🚀 클릭 완료. 최종 결과 대기 중 (7초)...");
      await new Promise((r) => setTimeout(r, 7000));

      // [3] 최종 성공 판정 로직 (업데이트됨)
      console.log("\n===========================================");

      // ✅ 판정 조건: 팝업이 2회 이상 발생하고, 그중 성공 키워드가 포함된 팝업이 있어야 함
      if (dialogCount >= 2 && isSuccessConfirmed) {
        console.log("🎊 [최종 결과] 저장 및 전송 성공! (키워드 확인 완료)");
      } else if (isSuccessConfirmed) {
        console.log(
          "⚠️ [최종 결과] 성공 키워드는 확인되었으나 팝업 횟수가 예상과 다릅니다."
        );
      } else {
        console.log(
          "❌ [최종 결과] 저장 실패 또는 오류 발생 (성공 메시지 확인 불가)"
        );
      }

      console.log(`📊 처리된 총 팝업: ${dialogCount}개`);
      console.log("===========================================\n");
    } else {
      console.error("❌ [test8.js] 저장 버튼을 찾지 못했습니다.");
    }
  } catch (err) {
    console.error("❌ [test8.js] 실행 중 예외 발생:", err.message);
  }

  console.log("🏁 [test8.js] 모든 공정 종료.");
}

module.exports = { finalizeRegistration };

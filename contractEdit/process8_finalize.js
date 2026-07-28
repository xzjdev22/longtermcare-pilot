/**
 * [process8_finalize.js]
 * 최종 [저장 및 통보] 처리 및 공단 팝업 결과 수집 모듈
 */

const { smartClick } = require("../utils/click");

/**
 * 저장 및 통보 버튼을 클릭하고 공단 다이얼로그 결과를 감지하여 반환합니다.
 * @param {object} page - Puppeteer page
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function finalizeRegistration(page) {
  console.log(
    "\n💾 [process8_finalize.js] 최종 [저장 및 통보] 프로세스 시작..."
  );

  let dialogCount = 0;
  let isSuccessConfirmed = false;
  const capturedMessages = [];

  // [1] 다이얼로그(팝업) 이벤트 핸들러
  const dialogHandler = async (dialog) => {
    dialogCount++;
    const msg = dialog.message();
    capturedMessages.push(msg);

    console.log(`\n-------------------------------------------`);
    console.log(`💬 [팝업 ${dialogCount}] 포착`);
    console.log(`📝 내용: ${msg}`);
    console.log(`-------------------------------------------`);

    // '완료' 또는 '성공' 키워드가 확인되면 성공 플래그 set
    if (msg.includes("완료") || msg.includes("성공")) {
      isSuccessConfirmed = true;
    }

    // 대기 후 확인 클릭
    await new Promise((r) => setTimeout(r, 1500));
    await dialog.accept();
    console.log(`✅ [팝업 ${dialogCount}] 확인 클릭 완료.`);
  };

  // 이벤트 리스너 바인딩
  page.on("dialog", dialogHandler);

  try {
    // [2] [저장 및 통보] 버튼 탐색
    const saveBtnSelector =
      'xpath///div[contains(@id, "btn_save")]//div[text()="저장 및 통보"]';
    const frames = page.frames();
    let targetFrame = null;
    let saveBtn = null;

    for (const frame of frames) {
      saveBtn = await frame.$(saveBtnSelector);
      if (saveBtn) {
        targetFrame = frame;
        break;
      }
    }

    if (!saveBtn) {
      console.error("❌ [process8_finalize.js] 저장 버튼을 찾지 못했습니다.");
      page.off("dialog", dialogHandler); // 리스너 해제
      return {
        success: false,
        message: "저장 버튼(btn_save)을 찾지 못함",
      };
    }

    console.log("🎯 [저장 및 통보] 버튼 발견! 클릭 시도...");
    await smartClick(page, targetFrame, saveBtn);

    console.log("🚀 클릭 완료. 최종 결과 대기 중 (6초)...");
    await new Promise((r) => setTimeout(r, 6000));

    // 이벤트 리스너 해제
    page.off("dialog", dialogHandler);

    // [3] 결과 분석 및 반환 데이터 구성
    const fullMessage = capturedMessages.join(" | ") || "팝업 메시지 없음";
    console.log("\n===========================================");

    if (dialogCount >= 2 && isSuccessConfirmed) {
      console.log("🎊 [최종 결과] 저장 및 전송 성공!");
      console.log(`📊 처리된 총 팝업: ${dialogCount}개`);
      console.log("===========================================\n");
      return {
        success: true,
        message: fullMessage,
      };
    } else if (isSuccessConfirmed) {
      console.log(
        "⚠️ [최종 결과] 성공 키워드는 확인되었으나 팝업 횟수가 다릅니다."
      );
      console.log(`📊 처리된 총 팝업: ${dialogCount}개`);
      console.log("===========================================\n");
      return {
        success: true,
        message: `[경고] ${fullMessage}`,
      };
    } else {
      console.log("❌ [최종 결과] 저장 실패 또는 오류 발생");
      console.log(`📊 처리된 총 팝업: ${dialogCount}개`);
      console.log("===========================================\n");
      return {
        success: false,
        message: fullMessage,
      };
    }
  } catch (err) {
    page.off("dialog", dialogHandler);
    console.error("❌ [process8_finalize.js] 실행 중 예외 발생:", err.message);
    return {
      success: false,
      message: `예외 발생: ${err.message}`,
    };
  }
}

module.exports = { finalizeRegistration };

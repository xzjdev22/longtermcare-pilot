const readline = require("readline");
const { smartClick } = require("../utils/click");

/**
 * CLI 입력을 위한 헬퍼 함수
 * @param {string} query 사용자에게 보여줄 메시지
 * @returns {Promise<string>} 사용자 입력값
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

/**
 * [Process 1] 수급자 검색 및 상세 등록 화면 진입
 */
async function clickSearchButton(page) {
  console.log("\n-------------------------------------------");
  console.log("🔍 [process1_search.js] 검색 및 등록 프로세스 시작");
  console.log("-------------------------------------------\n");

  // 🎯 [CLI 전략] 하드코딩 제거: 사용자에게 수급자 성함을 묻습니다.
  let targetName = await askQuestion(
    "👤 조회할 수급자 성함을 입력하세요 (기본값: 김금돌): "
  );
  if (!targetName.trim()) targetName = "김금돌";

  const frames = page.frames();
  let workFrame = null;

  // 넥사크로 작업 프레임 탐색
  for (const frame of frames) {
    if (
      frame.name().includes("winNPA03020000") ||
      (await frame.$('xpath///div[contains(@id, "btn_select")]'))
    ) {
      workFrame = frame;
      break;
    }
  }

  if (!workFrame) {
    console.error(
      "❌ [process1_search.js] 작업 프레임을 찾을 수 없습니다. 메인 화면인지 확인하세요."
    );
    return;
  }

  // ---------------------------------------------------------
  // [STEP 0] 유효 체크박스 체크 (현재 유효한 계약자만 필터링)
  // ---------------------------------------------------------
  const validCheckbox = await workFrame.$(
    'xpath///div[contains(@id, "chk_validCtr")]'
  );
  if (validCheckbox) {
    console.log("✅ '유효' 체크박스 활성화");
    await smartClick(page, workFrame, validCheckbox);
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---------------------------------------------------------
  // [STEP 1] 급여종별 설정 (방문목욕 고정)
  // ---------------------------------------------------------
  const payTypeDropBtn = await workFrame.$(
    'xpath///div[contains(@id, "cmb_ltcpClsfcCd.dropbutton")]'
  );
  if (payTypeDropBtn) {
    console.log("📂 급여종별: [방문목욕] 선택 중...");
    await smartClick(page, workFrame, payTypeDropBtn);
    await new Promise((r) => setTimeout(r, 800));

    // 콤보박스 아이템 중 2번(방문목욕) 선택
    const bathItem = await workFrame.$(
      'xpath///div[contains(@id, "cmb_ltcpClsfcCd.combolist.item_2")]'
    );
    if (bathItem) await smartClick(page, workFrame, bathItem);
  }

  // ---------------------------------------------------------
  // [STEP 2] 수급자명 입력 (CLI 입력값 적용)
  // ---------------------------------------------------------
  const nameInput = await workFrame.$(
    'xpath///input[contains(@id, "edt_fnm:input")]'
  );
  if (nameInput) {
    console.log(`⌨️ 대상자 입력: [${targetName}]`);
    await nameInput.click({ clickCount: 3 }); // 기존 텍스트 전체 선택
    await page.keyboard.press("Backspace");
    await page.keyboard.type(targetName);
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---------------------------------------------------------
  // [STEP 3] 조회 버튼 클릭
  // ---------------------------------------------------------
  const selectButton = await workFrame.$(
    'xpath///div[contains(@id, "btn_select") and text()="조회"]'
  );
  if (selectButton) {
    console.log("🖱️ 조회 버튼 클릭 및 데이터 로딩 대기...");
    await smartClick(page, workFrame, selectButton);
    await new Promise((r) => setTimeout(r, 3000)); // 그리드 갱신 시간 확보
  }

  // ---------------------------------------------------------
  // [STEP 4] 결과 그리드에서 마지막 행 선택
  // ---------------------------------------------------------
  const allRows = await workFrame.$$(
    'xpath///div[contains(@id, "grd_CtrContn.body.gridrow_")]'
  );
  if (allRows.length > 0) {
    const lastRow = allRows[allRows.length - 1];
    await smartClick(page, workFrame, lastRow);
    console.log(`✅ [${targetName}] 수급자 행 선택 완료 (최신 데이터 기준)`);
    await new Promise((r) => setTimeout(r, 1000));
  } else {
    console.warn(`⚠️ [알림] ${targetName} 님에 대한 검색 결과가 없습니다.`);
    return;
  }

  // ---------------------------------------------------------
  // [STEP 5] 급여계약내용 등록 버튼 클릭 (상세 진입)
  // ---------------------------------------------------------
  const registerButton = await workFrame.$(
    'xpath///div[contains(@id, "btn_regPaymtContnNtct")]'
  );
  if (registerButton) {
    console.log("🚀 [급여계약내용 등록] 화면으로 진입합니다.");
    await smartClick(page, workFrame, registerButton);
    // 상세 화면 팝업이 뜰 때까지 대기
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    console.error(
      "❌ [등록] 버튼을 찾을 수 없습니다. 권한 혹은 화면 상태를 확인하세요."
    );
  }
}

module.exports = { clickSearchButton };

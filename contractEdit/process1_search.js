const { smartClick } = require("../utils/click");

/**
 * [Process 1] 수급자 검색 및 상세 등록 화면 진입 (자동화 버전)
 * @param {object} page - Puppeteer page
 * @param {string} targetName - 검색할 수급자 성함 🎯
 */
async function clickSearchButton(page, targetName) {
  console.log("\n-------------------------------------------");
  console.log(
    `🔍 [process1_search.js] 수급자 [${targetName}] 검색 및 등록 프로세스 시작`
  );
  console.log("-------------------------------------------\n");

  if (!targetName) {
    throw new Error("❌ 검색할 수급자명이 전달되지 않았습니다.");
  }

  const frames = page.frames();
  let workFrame = null;

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
    throw new Error("❌ [process1_search.js] 작업 프레임을 찾을 수 없습니다.");
  }

  // [STEP 0] 유효 체크박스
  const validCheckbox = await workFrame.$(
    'xpath///div[contains(@id, "chk_validCtr")]'
  );
  if (validCheckbox) {
    await smartClick(page, workFrame, validCheckbox);
    await new Promise((r) => setTimeout(r, 500));
  }

  // [STEP 1] 급여종별 (방문목욕)
  const payTypeDropBtn = await workFrame.$(
    'xpath///div[contains(@id, "cmb_ltcpClsfcCd.dropbutton")]'
  );
  if (payTypeDropBtn) {
    await smartClick(page, workFrame, payTypeDropBtn);
    await new Promise((r) => setTimeout(r, 800));
    const bathItem = await workFrame.$(
      'xpath///div[contains(@id, "cmb_ltcpClsfcCd.combolist.item_2")]'
    );
    if (bathItem) await smartClick(page, workFrame, bathItem);
  }

  // [STEP 2] 수급자명 입력
  const nameInput = await workFrame.$(
    'xpath///input[contains(@id, "edt_fnm:input")]'
  );
  if (nameInput) {
    await nameInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(targetName);
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 500));
  }

  // [STEP 3] 조회 버튼
  const selectButton = await workFrame.$(
    'xpath///div[contains(@id, "btn_select") and text()="조회"]'
  );
  if (selectButton) {
    await smartClick(page, workFrame, selectButton);
    await new Promise((r) => setTimeout(r, 3000));
  }

  // [STEP 4] 행 선택
  const allRows = await workFrame.$$(
    'xpath///div[contains(@id, "grd_CtrContn.body.gridrow_")]'
  );
  if (allRows.length > 0) {
    const lastRow = allRows[allRows.length - 1];
    await smartClick(page, workFrame, lastRow);
    await new Promise((r) => setTimeout(r, 1000));
  } else {
    throw new Error(`❌ 수급자 [${targetName}] 검색 결과가 없습니다.`);
  }

  // [STEP 5] 등록 버튼
  const registerButton = await workFrame.$(
    'xpath///div[contains(@id, "btn_regPaymtContnNtct")]'
  );
  if (registerButton) {
    await smartClick(page, workFrame, registerButton);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

module.exports = { clickSearchButton };

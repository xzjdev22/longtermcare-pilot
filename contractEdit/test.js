const { smartClick } = require("../utils/click");

async function clickSearchButton(page) {
  console.log("🔍 [김금돌] 검색 및 등록 프로세스를 시작합니다...");

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
    console.error("❌ 작업 프레임을 찾을 수 없습니다.");
    return;
  }

  // ---------------------------------------------------------
  // [NEW STEP] 유효 체크박스 체크
  // ---------------------------------------------------------
  console.log("✅ '유효' 체크박스를 클릭합니다.");
  const validCheckbox = await workFrame.$(
    'xpath///div[contains(@id, "chk_validCtr")]'
  );
  if (validCheckbox) {
    await smartClick(page, workFrame, validCheckbox);
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---------------------------------------------------------
  // [STEP 1] 급여종별 설정 (방문목욕)
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // [STEP 2] 수급자명 입력 (김금돌)
  // ---------------------------------------------------------
  const nameInput = await workFrame.$(
    'xpath///input[contains(@id, "edt_fnm:input")]'
  );
  if (nameInput) {
    await nameInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type("김금돌");
    await page.keyboard.press("Enter");
  }

  // ---------------------------------------------------------
  // [STEP 3] 조회 버튼 클릭
  // ---------------------------------------------------------
  const selectButton = await workFrame.$(
    'xpath///div[contains(@id, "btn_select") and text()="조회"]'
  );
  if (selectButton) {
    await smartClick(page, workFrame, selectButton);
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ---------------------------------------------------------
  // [STEP 4] 마지막 Row(행) 선택
  // ---------------------------------------------------------
  const allRows = await workFrame.$$(
    'xpath///div[contains(@id, "grd_CtrContn.body.gridrow_")]'
  );
  if (allRows.length > 0) {
    const lastRow = allRows[allRows.length - 1];
    await smartClick(page, workFrame, lastRow);
    console.log("✅ 마지막 행(김금돌) 선택 완료");
    await new Promise((r) => setTimeout(r, 1000));
  }

  // ---------------------------------------------------------
  // [STEP 5] 급여계약내용 등록 버튼 클릭 (신규 추가)
  // ---------------------------------------------------------
  console.log("📝 [급여계약내용 등록] 버튼을 클릭합니다.");
  const registerButton = await workFrame.$(
    'xpath///div[contains(@id, "btn_regPaymtContnNtct")]'
  );

  if (registerButton) {
    // 버튼 클릭
    await smartClick(page, workFrame, registerButton);
    console.log("🚀 등록 화면으로 진입합니다.");

    // 화면 전환 또는 팝업 로딩 대기
    await new Promise((r) => setTimeout(r, 2000));
    await page.screenshot({ path: "registration_page.png" });
  } else {
    console.error("❌ [급여계약내용 등록] 버튼을 찾을 수 없습니다.");
  }
}

module.exports = { clickSearchButton };

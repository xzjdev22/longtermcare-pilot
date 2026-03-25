/**
 * [index.js] 급여계약내용 등록 자동화 메인 컨트롤러
 */
const { ask, closeInterface } = require("../utils/readline"); // utils/readline 활용
const { smartClick } = require("../utils/click");
const { clickSearchButton } = require("./process1_search"); // [Step 1] 대상자 조회 및 메뉴 진입
const { fillRegistrationDetails } = require("./process2_init"); // [Step 2] 년월 선택 및 입력 모드 활성화
const { selectMultiplePersons } = require("./process3_select"); // [Step 3] 대상자 추가
const { inputServiceTime } = require("./process4_time"); // [Step 4] 서비스 시간 입력
const { selectComboItem } = require("./process5_method"); // [Step 5] 서비스 방법 선택
const { finalizeInput } = require("./process6_grid"); // [Step 6] 중간 [입력] 버튼 클릭
const { selectServiceDays } = require("./process7_calendar"); // [Step 7] 날짜별 체크박스 정밀 타격
const { finalizeRegistration } = require("./process8_finalize"); // [Step 8] 최종 저장 및 팝업 지연 처리

async function runContractEdit(page) {
  // [삭제] 여기서 직접 rl을 생성하지 않고 utils의 ask를 사용합니다.

  console.log("\n====================================================");
  console.log("🚀 [Longterm-Bot] 비즈니스 로직 자동화 공정 시작");
  console.log("====================================================");

  try {
    // [GATEWAY] 메뉴 진입 로직
    console.log("📋 [급여계약내용] 메뉴 진입 시도...");
    let menuElement = null;
    let menuFrame = null;
    for (const frame of page.frames()) {
      try {
        const elements = await frame.$$(
          'xpath///div[contains(@class, "nexacontentsbox") and contains(text(), "급여계약내용 등록변경해지")]'
        );
        if (elements.length > 0) {
          menuElement = elements[0];
          menuFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    if (!menuElement)
      throw new Error("'급여계약내용 등록변경해지' 메뉴를 찾을 수 없습니다.");

    // 메뉴 클릭 및 로딩 대기
    await smartClick(page, menuFrame, menuElement);
    console.log("⏳ 메뉴 로딩 대기 (3초)...");
    await new Promise((r) => setTimeout(r, 3000));

    // [PHASE A] 기초 조회 및 환경 설정
    await clickSearchButton(page);
    await fillRegistrationDetails(page); // 이제 이 안에서는 조회까지만 수행합니다.

    // [PHASE B] 상세 데이터 입력 및 구성 (루프 적용) 🔄
    let addMore = true;
    while (addMore) {
      console.log("\n➕ 새로운 서비스 행 추가 및 데이터 작성을 시작합니다.");

      // [추가] PHASE B의 시작점: [입력] 버튼을 클릭하여 새 행을 만듭니다.
      await addNewRow(page);

      await selectMultiplePersons(page);

      // utils에서 불러온 ask를 그대로 사용합니다.
      await inputServiceTime(page, ask);

      await selectComboItem(page);
      await finalizeInput(page);

      console.log("\n-------------------------------------------");
      const answer = await ask("❓ 추가로 입력할 시간대가 있습니까? (y/n): ");
      if (answer.toLowerCase() !== "y") {
        addMore = false;
      }
      console.log("-------------------------------------------");
    }

    // [PHASE C] 날짜 확정 및 최종 저장
    // [중요] process7_calendar 내부에서도 utils/readline의 ask를 사용하도록 수정해야 합니다.
    await selectServiceDays(page);
    await finalizeRegistration(page);

    console.log("\n====================================================");
    console.log("🎊 [SUCCESS] 모든 비즈니스 프로세스가 정상 종료되었습니다.");
    console.log("====================================================\n");
  } catch (error) {
    console.log("\n----------------------------------------------------");
    console.error(`❌ [CRITICAL ERROR] 프로세스 중단: ${error.message}`);
    console.log("----------------------------------------------------\n");
  } finally {
    // 모든 과정이 끝난 후 유틸리티를 통해 한 번만 닫습니다.
    closeInterface();
  }
}

/**
 * PHASE B의 첫 번째 액션: [입력] 버튼 클릭 (기존 process2_init의 로직 계승)
 */
async function addNewRow(page) {
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("framesetWork") || f.name().includes("winNPA03020000")
  );

  // 기존 프레임 탐색 로직 유지
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
    throw new Error("❌ [행 추가] 메인 작업 프레임을 찾을 수 없습니다.");

  console.log("📝 [입력] 버튼 클릭 시도...");
  const addBtnSelector =
    'xpath///div[contains(@id, "btn_addRow")]//div[text()="입력"]';

  try {
    await workFrame.waitForSelector(addBtnSelector, { timeout: 5000 });
    const addBtn = await workFrame.$(addBtnSelector);
    if (addBtn) {
      await smartClick(page, workFrame, addBtn);
      console.log("✅ [입력] 버튼 클릭 성공 (새 행 추가됨)");
      await new Promise((r) => setTimeout(r, 1500)); // 행 생성 후 렌더링 대기
    }
  } catch (btnErr) {
    console.error("❌ [입력] 버튼을 찾을 수 없습니다.");
  }
}

module.exports = { runContractEdit };

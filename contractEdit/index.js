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
    await fillRegistrationDetails(page);

    // [PHASE B] 상세 데이터 입력 및 구성 (루프 적용) 🔄
    let addMore = true;
    while (addMore) {
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

module.exports = { runContractEdit };

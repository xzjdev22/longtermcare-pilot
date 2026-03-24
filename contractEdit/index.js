const { smartClick } = require("../utils/click");
const { clickSearchButton } = require("./test");
const { fillRegistrationDetails } = require("./test2"); // 날짜선택 + 조회 + 입력클릭
const { selectMultiplePersons } = require("./test3"); // 두 명 선택 + 추가(화살표)클릭
const { inputServiceTime } = require("./test4"); // 원복된 시간 입력
const { selectComboItem } = require("./test5"); // 새로 분리한 콤보박스 선택
const { finalizeInput } = require("./test6"); // 추가

/**
 * 급여계약내용 등록 메인 프로세스
 */
async function runContractEdit(page) {
  console.log("\n📋 [급여계약내용] 메뉴 진입 시도...");
  const frames = page.frames();
  let menuElement = null;
  let menuFrame = null;

  for (const frame of frames) {
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

  if (menuElement) {
    await smartClick(page, menuFrame, menuElement);
    console.log("⏳ 메뉴 로딩 대기 (3초)...");
    await new Promise((r) => setTimeout(r, 3000));

    // [STEP 1] 메인 화면에서 대상자 조회 및 등록 버튼 클릭
    await clickSearchButton(page);

    // [STEP 2] 팝업: 년월 선택, 조회, 입력 버튼 클릭 (test2.js)
    await fillRegistrationDetails(page);

    // [STEP 3] 팝업: 대상자(이복열, 추해숙) 선택 및 추가 버튼 클릭 (test3.js)
    await selectMultiplePersons(page);

    // [STEP 4] 시간 입력
    await inputServiceTime(page);

    // [STEP 5] 서비스 방법(차량내 목욕 등) 콤보 선택
    await selectComboItem(page);

    // [STEP 6] 최종 [입력] 버튼 클릭 🎯
    await finalizeInput(page);

    console.log("📍 [급여계약내용] 메뉴 내 모든 자동화 단계가 완료되었습니다.");
  } else {
    console.error("❌ 메뉴 요소를 찾을 수 없습니다.");
  }
}

module.exports = { runContractEdit };

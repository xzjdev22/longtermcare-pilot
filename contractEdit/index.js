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
  console.log("\n====================================================");
  console.log("🚀 [Longterm-Bot] 비즈니스 로직 자동화 공정 시작");
  console.log("====================================================");

  // [추가] 입력된 시간대 정보를 저장할 배열
  const timeSlots = [];

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

    // ---------------------------------------------------------
    // [PHASE B] 상세 데이터 입력 루프 (시간대 정보 수집) 🔄
    // ---------------------------------------------------------
    let addMore = true;
    while (addMore) {
      console.log(
        `\n➕ [${timeSlots.length + 1}번째] 서비스 행 추가를 시작합니다.`
      );

      await addNewRow(page);
      await selectMultiplePersons(page);

      // [수정] inputServiceTime에서 반환된 { startTime, endTime }을 배열에 저장합니다.
      const timeData = await inputServiceTime(page, ask);
      if (timeData) {
        // [수정 포인트 1] 현재 행 번호(rowIdx)를 함께 저장 (0부터 시작)
        timeSlots.push({
          ...timeData,
          rowIdx: timeSlots.length,
        });
      }

      await selectComboItem(page);
      await finalizeInput(page);

      console.log("\n-------------------------------------------");
      const answer = await ask("❓ 추가로 입력할 시간대가 있습니까? (y/n): ");
      if (answer.toLowerCase() !== "y") {
        addMore = false;
      }
      console.log("-------------------------------------------");
    }

    // ---------------------------------------------------------
    // [PHASE C] 시간대별 날짜 확정 (순차적 질문) 📅
    // ---------------------------------------------------------
    if (timeSlots.length > 0) {
      console.log("\n-------------------------------------------");
      console.log("📅 입력된 시간대별로 적용할 날짜를 선택합니다.");
      console.log("-------------------------------------------");

      for (const slot of timeSlots) {
        const timeLabel = `${slot.startTime} ~ ${slot.endTime}`;

        // [수정 포인트 2] slot 객체 전체가 아닌, slot.rowIdx(숫자)를 전달합니다.
        await selectServiceDays(page, ask, timeLabel, slot.rowIdx);
      }
    }

    // ---------------------------------------------------------
    // [FINAL PHASE] 최종 검토 및 저장
    // ---------------------------------------------------------
    console.log(
      "\n👀 모든 입력이 완료되었습니다. 화면의 체크 상태를 확인해 주세요."
    );
    const finalConfirm = await ask(
      "❓ 모든 정보가 정상입니까? 최종 저장하시겠습니까? (y/n): "
    );

    if (
      finalConfirm.toLowerCase() === "y" ||
      finalConfirm.toLowerCase() === "yy"
    ) {
      await finalizeRegistration(page);
    } else {
      console.log("\n🛑 사용자가 저장을 취소했습니다. 프로세스를 종료합니다.");
    }

    console.log("\n====================================================");
    console.log("🎊 [SUCCESS] 모든 비즈니스 프로세스가 정상 종료되었습니다.");
    console.log("====================================================\n");
  } catch (error) {
    console.log("\n----------------------------------------------------");
    console.error(`❌ [CRITICAL ERROR] 프로세스 중단: ${error.message}`);
    console.log("----------------------------------------------------\n");
  } finally {
    closeInterface();
  }
}

/**
 * PHASE B의 첫 번째 액션: [입력] 버튼 클릭 (프레임 탐색 로직 포함)
 */
async function addNewRow(page) {
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("framesetWork") || f.name().includes("winNPA03020000")
  );

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
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (btnErr) {
    console.error("❌ [입력] 버튼을 찾을 수 없습니다.");
  }
}

module.exports = { runContractEdit };

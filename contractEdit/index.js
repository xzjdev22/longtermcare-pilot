/**
 * [index.js] 급여계약내용 등록 자동화 메인 컨트롤러 (수급자 루프 버전)
 */
const { ask, closeInterface } = require("../utils/readline");
const { smartClick } = require("../utils/click");
const { clickSearchButton } = require("./process1_search");
const { fillRegistrationDetails } = require("./process2_init");
const { selectMultiplePersons } = require("./process3_select");
const { inputServiceTime } = require("./process4_time");
const { selectComboItem } = require("./process5_method");
const { finalizeInput } = require("./process6_grid");
const { selectServiceDays } = require("./process7_calendar");
const { finalizeRegistration } = require("./process8_finalize");

async function runContractEdit(page) {
  console.log("\n====================================================");
  console.log("🚀 [Longterm-Bot] 비즈니스 로직 자동화 공정 시작");
  console.log("====================================================");

  try {
    // [GATEWAY] 메뉴 진입 로직 (프로그램 시작 시 딱 한 번만 수행)
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

    await smartClick(page, menuFrame, menuElement);
    console.log("⏳ 메뉴 로딩 대기 (3초)...");
    await new Promise((r) => setTimeout(r, 3000));

    // ---------------------------------------------------------
    // 🔄 [MASTER LOOP] 수급자 단위 무한 반복 시작
    // ---------------------------------------------------------
    let continueOverall = true;
    while (continueOverall) {
      // [PHASE A] 기초 조회 (🎯 중요: ask 함수를 인자로 넘겨줍니다)
      await clickSearchButton(page, ask);

      // 상세창 진입 후 기초 설정
      await fillRegistrationDetails(page);

      // [PHASE B & C] 시간대별 데이터 입력 루프
      let addMoreTime = true;
      while (addMoreTime) {
        console.log("\n➕ 새로운 서비스 행 추가 및 데이터 작성을 시작합니다.");

        await addNewRow(page);
        await selectMultiplePersons(page);

        // 서비스 시간 입력 (ask 유틸 전달)
        const timeInfo = await inputServiceTime(page, ask);
        const timeLabel = `${timeInfo.startTime} ~ ${timeInfo.endTime}`;

        await selectComboItem(page);
        await finalizeInput(page);

        // 날짜 선택 (ask 유틸 전달)
        console.log(`\n📅 [${timeLabel}] 시간대에 적용할 날짜를 선택합니다.`);
        await selectServiceDays(page, ask, timeLabel);

        console.log("\n-------------------------------------------");
        const answer = await ask(
          `❓ 추가로 입력할 시간대가 더 있습니까? (y/n): `
        );
        if (answer.toLowerCase() !== "y") {
          addMoreTime = false;
        }
        console.log("-------------------------------------------");
      }

      // [FINAL PHASE] 최종 검토 및 저장
      console.log(
        "\n👀 모든 시간대와 날짜 입력이 완료되었습니다. 화면을 확인해 주세요."
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
        console.log("\n🛑 사용자가 저장을 취소했습니다.");
      }

      // 🎯 한 명의 처리가 끝난 후 루프 지속 여부 확인
      console.log("\n====================================================");
      const nextPerson = await ask(
        "🔄 다음 수급자를 처리하시겠습니까? (y/n): "
      );
      if (nextPerson.toLowerCase() !== "y") {
        continueOverall = false;
        console.log("👋 모든 작업을 마치고 프로그램을 종료합니다.");
      } else {
        console.log("🆕 메인 화면에서 다음 조회를 준비합니다...");
        // Tip: finalizeRegistration에서 팝업 확인 후 상세창이 닫혔으므로 바로 재조회 가능
      }
      console.log("====================================================\n");
    }
  } catch (error) {
    console.log("\n----------------------------------------------------");
    console.error(`❌ [CRITICAL ERROR] 프로세스 중단: ${error.message}`);
    console.log("----------------------------------------------------\n");
  } finally {
    // 모든 루프가 완전히 종료되었을 때만 인터페이스를 닫습니다.
    closeInterface();
  }
}

/**
 * [입력] 버튼 클릭 (행 추가)
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

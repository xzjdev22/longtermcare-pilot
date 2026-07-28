/**
 * [index.js] 급여계약내용 등록 자동화 메인 컨트롤러 (CSV 완전 자동화 버전)
 */
const { parseAndGroupCsv, saveResultLog } = require("../utils/csvHandler");
const { smartClick } = require("../utils/click");
const { clickSearchButton } = require("./process1_search");
const { fillRegistrationDetails } = require("./process2_init");
const { selectMultiplePersons } = require("./process3_select");
const { inputServiceTime } = require("./process4_time");
const { selectComboItem } = require("./process5_method");
const { finalizeInput } = require("./process6_grid");
const { selectServiceDays } = require("./process7_calendar");
const { finalizeRegistration } = require("./process8_finalize");
const { Test } = require("./test");

async function runContractEdit(page) {
  console.log("\n====================================================");
  console.log("🚀 [Longterm-Bot] CSV 데이터 기반 비즈니스 로직 자동화 시작");
  console.log("====================================================");

  const csvInputPath =
    "data/google_calendar_export - Google_Calendar_Export.csv";
  const csvOutputPath = "data/google_calendar_export_result.csv";

  // 1. CSV 파싱 및 수급자별 그룹화
  const processedData = parseAndGroupCsv(csvInputPath);
  console.log(`📊 총 ${processedData.length}명의 수급자 데이터 로드 완료.\n`);

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
    // 🔄 [MASTER LOOP] 수급자 단위 자동 루프
    // ---------------------------------------------------------
    for (const person of processedData) {
      console.log(`\n====================================================`);
      console.log(`👤 [수급자] ${person.name} 자동 처리 시작`);
      console.log(`====================================================`);

      try {
        // [PHASE A] 기초 조회
        await clickSearchButton(page, person.name);
        await fillRegistrationDetails(page);

        // // [PHASE B & C] 시간대별 데이터 입력 루프
        // for (const slot of person.timeSlots) {
        //   const timeLabel = `${slot.startTime} ~ ${slot.endTime}`;
        //   console.log(`\n➕ [시간대 추가] ${timeLabel}`);

        //   try {
        //     await addNewRow(page);
        //     await selectMultiplePersons(page);

        //     // 서비스 시간 입력 (시간 객체 전달)
        //     await inputServiceTime(page, slot);

        //     await selectComboItem(page);
        //     await finalizeInput(page);

        //     // 날짜 선택 (날짜 배열 전달)
        //     console.log(
        //       `\n📅 [${timeLabel}] 시간대에 적용할 날짜들을 선택합니다.`
        //     );
        //     await selectServiceDays(page, slot.dates, timeLabel);

        //     // 개별 성공 표기
        //     slot.result = "SUCCESS";
        //     slot.message = "정상 입력 완료";
        //   } catch (slotErr) {
        //     console.error(`❌ [시간대 오류] ${timeLabel}: ${slotErr.message}`);
        //     slot.result = "FAILED";
        //     slot.message = slotErr.message;
        //   }
        // }

        // // [FINAL PHASE] 저장 버튼 클릭 및 팝업 결과 수집
        // console.log(`\n💾 [${person.name}] 최종 저장 및 공단 전송 시도...`);
        // const finalizeResult = await finalizeRegistration(page);

        // // 전체 팝업 결과 반영
        // for (const slot of person.timeSlots) {
        //   if (slot.result === "SUCCESS") {
        //     slot.result = finalizeResult.success ? "SUCCESS" : "FAILED";
        //     slot.message = finalizeResult.message;
        //   }
        // }
      } catch (personErr) {
        console.error(
          `❌ [수급자 처리 오류] ${person.name}: ${personErr.message}`
        );
        for (const slot of person.timeSlots) {
          slot.result = "FAILED";
          slot.message = personErr.message;
        }
      }
    }

    console.log("\n🏁 모든 수급자 데이터 처리가 완료되었습니다.");
  } catch (error) {
    console.log("\n----------------------------------------------------");
    console.error(`❌ [CRITICAL ERROR] 프로세스 중단: ${error.message}`);
    console.log("----------------------------------------------------\n");
  } finally {
    // 🎯 최종 결과 로그 CSV 파일 생성
    saveResultLog(csvOutputPath, processedData);
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

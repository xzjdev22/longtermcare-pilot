/**
 * [dev.js] 단품 프로세스 고속 테스트 스크립트 (Dev Mode)
 *
 * 💡 사용법:
 * 1. `node run.js` 실행 후 넥사크로 화면을 테스트하고 싶은 단계까지 띄워둡니다.
 * 2. `dev.js` 내부에서 원하는 프로세스 함수만 주석 해제/선택합니다.
 * 3. `node dev.js` 실행 시 세션 재연결 없이 1초 만에 해당 로직만 동작합니다.
 */
const puppeteer = require("puppeteer");
const { ask, closeInterface } = require("./utils/readline");
const { runManualContractEdit } = require("./contractEditManual");

// 🎯 단품 테스트할 모듈들을 불러옵니다.
const { clickSearchButton } = require("./contractEdit/process1_search");
const { fillRegistrationDetails } = require("./contractEdit/process2_init");
const { selectMultiplePersons } = require("./contractEdit/process3_select");
const { inputServiceTime } = require("./contractEdit/process4_time");
const { selectComboItem } = require("./contractEdit/process5_method");
const { finalizeInput } = require("./contractEdit/process6_grid");
const { selectServiceDays } = require("./contractEdit/process7_calendar");
const { finalizeRegistration } = require("./contractEdit/process8_finalize");
const { Test } = require("./contractEdit/test");

async function dev() {
  console.log("\n====================================================");
  console.log("⚡ [Dev-Runner] 기존 브라우저 세션 재연결 시도...");
  console.log("====================================================");

  let browser;
  try {
    // 1. 9222 포트로 오픈되어 있는 Chrome에 연결
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      defaultViewport: null,
    });

    const pages = await browser.pages();

    // 2. 롱텀 포털 페이지 탭 찾기
    const page = pages.find((p) => p.url().includes("longtermcare.or.kr"));

    if (!page) {
      console.error("❌ 롱텀 포털 페이지를 찾을 수 없습니다.");
      console.error("👉 먼저 'node run.js'를 통해 브라우저를 실행해 두세요.");
      return;
    }

    console.log("✅ 열려있는 넥사크로 페이지 감지 성공!");
    console.log(`🌐 TARGET URL: ${page.url()}\n`);

    // ---------------------------------------------------------
    // 🧪 [테스트구역] 여기서 수정 중인 특정 단계만 실행합니다.
    // ---------------------------------------------------------
    console.log("🧪단품 테스트를 시작합니다...");

    // 🎯 예: 저장(Finalize) 단계만 1초 만에 테스트
    // await Test(page);
    await runManualContractEdit(page);

    // 필요시 다른 단계만 테스트하고 싶을 때 주석 풀고 사용:
    // await clickSearchButton(page, ask);
    // await selectServiceDays(page, ask, "09:00 ~ 12:00");

    console.log("\n✅ [Dev-Runner] 단품 테스트 완료!");
  } catch (error) {
    console.log("\n----------------------------------------------------");
    console.error(`❌ [Dev Error] 단품 실행 중 오류 발생: ${error.message}`);
    console.log("----------------------------------------------------\n");
  } finally {
    // 단품 테스트 후 입력 스트림 정리 (브라우저는 닫히지 않고 그대로 유지됨)
    closeInterface();
  }
}

dev();

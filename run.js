const puppeteer = require("puppeteer");
const inquirer = require("inquirer");
const config = require("./config.json");
const { loginWithSession } = require("./login");
const { runContractEdit } = require("./contractEdit");
const { runManualContractEdit } = require("./contractEditManual");

const prompt = inquirer.createPromptModule();

async function main() {
  try {
    const sessionId = config.JSESSIONID;
    const targetUrl = `https://www.longtermcare.or.kr/npbs/xui/manage.html?SESSIONCHECK!${sessionId}&gv_xgateUrl!www.longtermcare.or.kr&gv_isPMSQ!Y&gv_initMenuId!null`;

    const browser = await puppeteer.launch({
      headless: false,
      args: [
        "--window-size=1440,900",
        "--remote-debugging-port=9222", // 🎯 원격 디버깅 포트 오픈 (dev.js에서 재접속 가능)
      ],
    });

    const page = await loginWithSession(browser, targetUrl);

    const { action } = await prompt([
      {
        type: "list",
        name: "action",
        message: "📂 작업을 선택하세요:",
        choices: [
          { name: "1. 급여계약내용 등록변경해지", value: "contract" },
          {
            name: "2. (수동)급여계약내용 등록변경해지",
            value: "manual_contract",
          },
        ],
      },
    ]);

    if (action === "contract") {
      await runContractEdit(page);
    } else if (action === "manual_contract") {
      await runManualContractEdit(page);
    }

    console.log(
      "\n🏁 [Longterm-Bot] 모든 자동화 프로세스가 최종 종료되었습니다."
    );
  } catch (error) {
    console.error("\n❌ 오류 발생:", error.message);
  }
}

main();

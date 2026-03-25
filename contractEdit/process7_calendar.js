const readline = require("readline");

/**
 * [test7.js] 날짜별 체크박스 일괄 정밀 타격 + 최종 저장 승인 CLI
 */
async function selectServiceDays(page) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise((res) => rl.question(q, res));

  // [1] 날짜 입력 받기
  const input = await ask(
    "\n📅 체크할 날짜들을 입력하세요 (공백 구분, 예: 4 11): "
  );
  const targetDays = input
    .split(/\s+/)
    .map(Number)
    .filter((d) => d > 0 && d <= 31);

  if (targetDays.length === 0) {
    console.log("⏩ 날짜 입력이 없어 종료합니다.");
    rl.close();
    return;
  }

  console.log(`🚀 [${targetDays.join(", ")}] 일괄 클릭 프로세스 시작...`);
  console.log("-------------------------------------------");

  // [2] 날짜 루프: 중단 없이 모든 날짜 클릭 시도
  for (const day of targetDays) {
    const cellIndex = 11 + day;
    const iconSelector = `div[id$="cell_1_${cellIndex}"] .cellcheckbox .nexacontentsbox`;

    try {
      const icon = await page.waitForSelector(iconSelector, { timeout: 2000 });

      if (icon) {
        const box = await icon.boundingBox();
        if (box) {
          // 정밀 마우스 클릭
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await new Promise((r) => setTimeout(r, 100));
          await page.mouse.up();

          await new Promise((r) => setTimeout(r, 600)); // 반영 대기

          // 상태 확인 로그만 출력
          const isChecked = await icon.evaluate((el) =>
            el.style.backgroundImage.includes("bg_check_S.png")
          );

          if (isChecked) {
            console.log(`✅ [${day}일] 클릭 성공 및 체크 확인`);
          } else {
            console.log(
              `⚠️ [${day}일] 클릭 수행됨 (화면에서 상태를 확인하세요)`
            );
          }
        }
      }
    } catch (e) {
      console.log(
        `❌ [${day}일] 요소를 찾지 못했습니다. (Index: ${cellIndex})`
      );
    }
  }

  // [3] 모든 클릭 종료 후 최종 확인 CLI 🎯
  console.log("-------------------------------------------");
  console.log(`👀 위 로그와 화면을 확인해 주세요.`);
  const finalConfirm = await ask(
    `❓ 모든 날짜가 정상적으로 입력되었습니까? 저장하시겠습니까? (y/n): `
  );
  console.log("-------------------------------------------\n");

  if (finalConfirm.toLowerCase() !== "y") {
    console.log(
      "🛑 사용자가 'n'을 선택했습니다. 저장 단계를 진행하지 않고 종료합니다."
    );
    rl.close();
    process.exit(0); // 프로세스 종료 (test8로 가지 않음)
  }

  console.log("🚀 최종 승인 완료! 저장 및 통보(test8.js) 단계로 진입합니다.");
  rl.close();
}

module.exports = { selectServiceDays };

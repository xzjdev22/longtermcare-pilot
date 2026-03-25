/**
 * 특정 셀에 값을 입력하는 헬퍼
 */
async function typeInCell(page, frame, selector, value, label) {
  const element = await frame.$(selector);
  if (!element) {
    console.error(`❌ ${label} 셀을 찾을 수 없습니다.`);
    return false;
  }

  const box = await element.boundingBox();
  if (box) {
    console.log(`🖱️ ${label} 입력: [${value}]`);
    // 1. 셀 클릭하여 입력 모드 활성화
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((r) => setTimeout(r, 400));
    // 2. 기존 내용 삭제
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    // 3. 값 입력
    await page.keyboard.type(value, { delay: 50 });
    // 4. Tab으로 입력 확정 및 포커스 이동
    await page.keyboard.press("Tab");
    await new Promise((r) => setTimeout(r, 400));
    return true;
  }
  return false;
}

// 인자로 ask를 받습니다.
async function inputServiceTime(page, ask) {
  console.log("📂 [process4_time.js] 서비스 시간 입력을 시작합니다...");

  // 기존의 readline 생성 코드를 삭제하고 전달받은 ask를 사용합니다.
  const startTime = await ask("▶ 시작 시간 입력 (예: 1100): ");
  const endTime = await ask("▶ 종료 시간 입력 (예: 1200): ");

  const frames = page.frames();
  let workFrame = null;
  for (const frame of frames) {
    try {
      if (await frame.$('div[id*="grd_choiceEggr"]')) {
        workFrame = frame;
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!workFrame)
    return console.error("❌ 하단 그리드 프레임을 찾을 수 없습니다.");

  try {
    const startTimeSelector =
      'div[id*="grd_choiceEggr.body.gridrow_0.cell_0_10"]';
    await typeInCell(page, workFrame, startTimeSelector, startTime, "시작시간");

    const endTimeSelector =
      'div[id*="grd_choiceEggr.body.gridrow_0.cell_0_11"]';
    await typeInCell(page, workFrame, endTimeSelector, endTime, "종료시간");

    console.log("✅ 시간 입력 프로세스가 완료되었습니다.");
  } catch (err) {
    console.error("❌ process4_time.js 실행 중 오류:", err.message);
  }
}

module.exports = { inputServiceTime };

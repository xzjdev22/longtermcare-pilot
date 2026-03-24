/**
 * 특정 셀에 값을 입력하는 헬퍼
 * CLI 확인 절차 없이 즉시 실행됩니다.
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

async function inputServiceTime(page) {
  console.log("📂 [test4.js] 서비스 시간 자동 입력을 시작합니다...");

  // 하단 그리드(grd_choiceEggr)가 있는 프레임 찾기
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

  if (!workFrame) {
    return console.error("❌ 하단 그리드 프레임을 찾을 수 없습니다.");
  }

  try {
    // 시작시간: cell_0_10 (11:00)
    const startTimeSelector =
      'div[id*="grd_choiceEggr.body.gridrow_0.cell_0_10"]';
    await typeInCell(page, workFrame, startTimeSelector, "1100", "시작시간");

    // 종료시간: cell_0_11 (12:00)
    const endTimeSelector =
      'div[id*="grd_choiceEggr.body.gridrow_0.cell_0_11"]';
    await typeInCell(page, workFrame, endTimeSelector, "1200", "종료시간");

    console.log("✅ 시간 입력 프로세스가 완료되었습니다.");
  } catch (err) {
    console.error("❌ test4.js 실행 중 오류:", err.message);
  }
}

module.exports = { inputServiceTime };

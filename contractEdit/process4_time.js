/**
 * 시작 시간을 기준으로 60분을 더한 종료 시간을 계산합니다. (HHMM 형식)
 */
function add60Minutes(startTimeStr) {
  const hours = parseInt(startTimeStr.substring(0, 2));
  const minutes = parseInt(startTimeStr.substring(2, 4));

  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + 60); // 60분 추가 (자동으로 시간 올림 처리됨)

  const nextHours = String(date.getHours()).padStart(2, "0");
  const nextMinutes = String(date.getMinutes()).padStart(2, "0");

  return `${nextHours}${nextMinutes}`;
}

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

async function inputServiceTime(page, ask) {
  console.log("📂 [process4_time.js] 서비스 시간 입력을 시작합니다...");

  // 시작 시간만 묻습니다.
  const startTime = await ask("▶ 시작 시간 입력 (예: 1100): ");

  // 60분을 자동으로 더해 종료 시간을 계산합니다.
  const endTime = add60Minutes(startTime);
  console.log(`💡 서비스 60분 고정: 종료 시간 [${endTime}] 자동 계산됨`);

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

    console.log(`✅ 시간 입력 완료: ${startTime} ~ ${endTime}`);
  } catch (err) {
    console.error("❌ process4_time.js 실행 중 오류:", err.message);
  }
}

module.exports = { inputServiceTime };

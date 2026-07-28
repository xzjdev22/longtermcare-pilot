/**
 * [process4_time.js] 서비스 시간 입력 모듈 (자동화 버전)
 */

/**
 * HH:MM 또는 HHMM 문자열을 HHMM 4자리 숫자로 변환 (예: "08:40" -> "0840")
 */
function formatTimeHHMM(timeStr) {
  if (!timeStr) return "0000";
  const clean = timeStr.replace(/[^0-9]/g, "");
  return clean.padStart(4, "0").substring(0, 4);
}

/**
 * 시작 시간을 기준으로 60분을 더한 종료 시간을 계산합니다. (HHMM 형식)
 */
function add60Minutes(startTimeStr) {
  const formatted = formatTimeHHMM(startTimeStr);
  const hours = parseInt(formatted.substring(0, 2), 10);
  const minutes = parseInt(formatted.substring(2, 4), 10);

  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + 60);

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
    // 2. 기존 내용 삭제 (M1 Mac 및 Windows 범용 백스페이스/Control+A)
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

/**
 * 서비스 시간 입력 함수
 * @param {object} page - Puppeteer page
 * @param {object} timeSlot - { startTime: "08:40", endTime: "09:40" } 객체 🎯
 */
async function inputServiceTime(page, timeSlot) {
  console.log("📂 [process4_time.js] 서비스 시간 입력을 시작합니다...");

  if (!timeSlot || !timeSlot.startTime) {
    throw new Error("❌ 서비스 시간 데이터가 없습니다.");
  }

  // HH:MM 형식 데이터를 HHMM 형식으로 포맷팅
  const startTime = formatTimeHHMM(timeSlot.startTime);
  let endTime = timeSlot.endTime ? formatTimeHHMM(timeSlot.endTime) : "";

  // End Time이 누락되었거나 계산이 필요한 경우 60분 자동 계산
  if (!endTime) {
    endTime = add60Minutes(startTime);
    console.log(`💡 서비스 60분 고정: 종료 시간 [${endTime}] 자동 계산됨`);
  }

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
    throw new Error("❌ 하단 그리드 프레임을 찾을 수 없습니다.");
  }

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
    throw err;
  }

  return { startTime, endTime };
}

module.exports = { inputServiceTime };

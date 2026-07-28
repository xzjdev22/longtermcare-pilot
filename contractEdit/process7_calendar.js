/**
 * [process7_calendar.js]
 * CSV 기반 달력 날짜 클릭 자동화 모듈
 */

/**
 * 특정 시간대(timeLabel)에 해당하는 그리드 행을 찾아서 날짜(daysArray)를 체크합니다.
 * @param {object} page - Puppeteer page
 * @param {string} timeLabel - 시간대 문자열 (예: "0840~0940" 또는 "08:40~09:40")
 * @param {Array<number|string>} daysArray - 클릭할 일자 배열 (예: [1, 2, 5, 12] 또는 ["1", "2"])
 */
async function selectServiceDays(page, timeLabel, daysArray) {
  try {
    if (!daysArray || !Array.isArray(daysArray) || daysArray.length === 0) {
      console.log(`⚠️ [Phase C] [${timeLabel}] 클릭할 날짜 데이터가 없습니다.`);
      return;
    }

    // HHMM 또는 HH:MM 형태에서 시작 시간 추출 후 HH:MM 형태로 표준화
    const searchTime = timeLabel.split("~")[0].replace(/[^0-9]/g, "");
    const formattedTime = `${searchTime.substring(0, 2)}:${searchTime.substring(
      2,
      4
    )}`;

    console.log(
      `🔎 [Phase C] 그리드에서 [${formattedTime}] 행 탐색 중... (적용 날짜: ${daysArray.join(
        ", "
      )}일)`
    );

    let rowIdx = null;
    let targetFrame = page;

    // 1. 모든 프레임을 검색하여 해당 시간(formattedTime)이 위치한 행(rowIdx) 찾기
    for (const frame of page.frames()) {
      const foundRow = await frame.evaluate((time) => {
        const cells = Array.from(
          document.querySelectorAll('div[id*=".cell_"]')
        );
        // 시간 셀은 주로 _5로 끝남
        const target = cells.find(
          (c) => c.id.endsWith("_5") && c.innerText.includes(time)
        );
        if (target) {
          const match = target.id.match(/gridrow_(\d+)/);
          return match ? match[1] : null;
        }
        return null;
      }, formattedTime);

      if (foundRow !== null) {
        rowIdx = foundRow;
        targetFrame = frame;
        break;
      }
    }

    if (rowIdx === null) {
      throw new Error(`그리드에서 [${formattedTime}] 행을 찾지 못했습니다.`);
    }
    console.log(`🎯 [Phase C] 매칭된 행: gridrow_${rowIdx} (프레임 확인 완료)`);

    // 2. 날짜 클릭 루프 (검증된 test7.js 정밀 클릭 적용)
    for (const day of daysArray) {
      const dayNum = parseInt(day, 10);
      if (isNaN(dayNum)) continue;

      const cellIdx = 11 + dayNum;

      // 특정 row의 특정 cell 내부 checkbox icon selector
      const iconSelector = `div[id$="gridrow_${rowIdx}.cell_${rowIdx}_${cellIdx}"] .cellcheckbox .nexacontentsbox`;

      try {
        const icon = await targetFrame.waitForSelector(iconSelector, {
          timeout: 3000,
        });

        if (icon) {
          const box = await icon.boundingBox();
          if (box) {
            // [정밀 타격] 마우스 이동 및 down/up
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2
            );
            await page.mouse.down();
            await new Promise((r) => setTimeout(r, 100));
            await page.mouse.up();

            // 반영 대기
            await new Promise((r) => setTimeout(r, 600));

            // 이미지 경로를 통한 체크 상태 최종 확인
            const isChecked = await icon.evaluate((el) =>
              window
                .getComputedStyle(el)
                .backgroundImage.includes("bg_check_S.png")
            );

            if (isChecked) {
              console.log(`  ✅ [${dayNum}일] 클릭 성공 및 체크 확인`);
            } else {
              console.log(`  ⚠️ [${dayNum}일] 클릭 수행됨 (체크 상태 미확인)`);
            }
          }
        }
      } catch (e) {
        console.error(
          `  ❌ [${dayNum}일] 요소를 찾지 못함 (Selector: ${iconSelector})`
        );
      }
    }
  } catch (err) {
    console.error(`❌ [Phase C] 날짜 선택 오류: ${err.message}`);
    throw err;
  }
}

module.exports = { selectServiceDays };

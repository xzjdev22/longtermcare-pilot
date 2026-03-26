/**
 * [process7_calendar.js]
 * 성공했던 test7.js의 정밀 타격 로직을 시간대별 루프에 이식
 */
async function selectServiceDays(page, ask, timeLabel) {
  try {
    const input = await ask(
      `📅 [${timeLabel}] 적용할 날짜들을 입력하세요 (공백 구분): `
    );
    if (!input) return;
    const daysArray = input.split(/\s+/).filter((d) => d.trim() !== "");

    const searchTime = timeLabel.split("~")[0].trim();
    const formattedTime = `${searchTime.substring(0, 2)}:${searchTime.substring(
      2,
      4
    )}`;

    console.log(`🔎 [Phase C] 그리드에서 [${formattedTime}] 행 탐색 중...`);

    let rowIdx = null;
    let targetFrame = page;

    // 1. 모든 프레임을 뒤져서 해당 시간이 있는 행(rowIdx) 찾기
    for (const frame of page.frames()) {
      const foundRow = await frame.evaluate((time) => {
        const cells = Array.from(
          document.querySelectorAll('div[id*=".cell_"]')
        );
        // 시간 셀은 보통 끝이 _5로 끝남
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

    if (rowIdx === null)
      throw new Error(`${formattedTime} 행을 찾지 못했습니다.`);
    console.log(`🎯 [Phase C] 매칭된 행: gridrow_${rowIdx} (프레임 확인 완료)`);

    // 2. 날짜 클릭 루프 (성공했던 test7.js 로직 적용)
    for (const day of daysArray) {
      const dayNum = parseInt(day);
      const cellIdx = 11 + dayNum;

      // 성공했던 Selector 패턴: 특정 row의 특정 cell 내부 checkbox icon
      const iconSelector = `div[id$="gridrow_${rowIdx}.cell_${rowIdx}_${cellIdx}"] .cellcheckbox .nexacontentsbox`;

      try {
        const icon = await targetFrame.waitForSelector(iconSelector, {
          timeout: 3000,
        });

        if (icon) {
          const box = await icon.boundingBox();
          if (box) {
            // [성공 로직] 정밀 마우스 이동 및 누르기(down/up)
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2
            );
            await page.mouse.down();
            await new Promise((r) => setTimeout(r, 100));
            await page.mouse.up();

            // 반영 대기 (성공 로직의 600ms 유지)
            await new Promise((r) => setTimeout(r, 600));

            // [성공 로직] 이미지 경로를 통한 체크 상태 확인
            const isChecked = await icon.evaluate((el) =>
              window
                .getComputedStyle(el)
                .backgroundImage.includes("bg_check_S.png")
            );

            if (isChecked) {
              console.log(`  ✅ [${day}일] 클릭 성공 및 체크 확인`);
            } else {
              // 가끔 backgroundImage가 즉시 안 바뀔 수 있으므로 일단 수행 로그 출력
              console.log(`  ⚠️ [${day}일] 클릭 수행됨 (화면 확인 필요)`);
            }
          }
        }
      } catch (e) {
        console.error(
          `  ❌ [${day}일] 요소를 찾지 못함 (Selector: ${iconSelector})`
        );
      }
    }
  } catch (err) {
    console.error(`❌ [Phase C] 날짜 선택 오류: ${err.message}`);
  }
}

module.exports = { selectServiceDays };

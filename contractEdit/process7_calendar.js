/**
 * [process7_calendar.js] 시간대별 날짜 체크박스 정밀 타격
 */
async function selectServiceDays(page, ask, timeLabel) {
  // timeLabel 예: "09:00 ~ 10:00" -> 여기서 시작 시간인 "09:00"만 추출
  const startTime = timeLabel.split("~")[0].trim();

  // [1] 화면에서 해당 시작 시간이 적힌 셀을 찾아 행(Row) 번호 알아내기
  // 넥사크로 특성상 text가 포함된 div를 찾고 그 부모의 id에서 gridrow_n을 추출합니다.
  const rowInfo = await page.evaluate((time) => {
    const cells = Array.from(document.querySelectorAll("div.nexacontentsbox"));
    const targetCell = cells.find((c) => c.innerText.includes(time));
    if (!targetCell) return null;

    // cell_2_5 같은 ID나 gridrow_2 같은 ID를 가진 조상 요소를 찾음
    const rowElement = targetCell.closest('div[id*="gridrow_"]');
    if (!rowElement) return null;

    const match = rowElement.id.match(/gridrow_(\d+)/);
    return match ? match[1] : null;
  }, startTime);

  if (!rowInfo) {
    console.log(
      `❌ [${timeLabel}] 해당 시간대의 행을 화면에서 찾을 수 없습니다.`
    );
    return;
  }

  const currentRow = rowInfo;
  console.log(`\n-------------------------------------------`);
  console.log(`📅 [${timeLabel}] 설정 (매칭된 행: gridrow_${currentRow})`);
  console.log(`-------------------------------------------`);

  const input = await ask(`👉 체크할 날짜들을 입력하세요: `);
  const targetDays = input
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((d) => d > 0 && d <= 31);

  if (targetDays.length === 0) return;

  // [2] 날짜 루프: 찾아낸 currentRow 번호를 사용하여 정밀 타격
  for (const day of targetDays) {
    const cellIndex = 11 + day;
    const iconSelector = `div[id$="gridrow_${currentRow}"] div[id*="cell_${currentRow}_${cellIndex}"] .cellcheckbox .nexacontentsbox`;

    try {
      const icon = await page.waitForSelector(iconSelector, { timeout: 2000 });
      if (icon) {
        const box = await icon.boundingBox();
        if (box) {
          // [기존 정밀 클릭 로직 100% 유지]
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await new Promise((r) => setTimeout(r, 100));
          await page.mouse.up();

          await new Promise((r) => setTimeout(r, 800)); // 반영 대기

          const isChecked = await icon.evaluate((el) =>
            el.style.backgroundImage.includes("bg_check_S.png")
          );

          if (isChecked) {
            console.log(`✅ [${day}일] 클릭 성공 및 체크 확인`);
          } else {
            console.log(`⚠️ [${day}일] 클릭 수행됨 (화면 확인 필요)`);
          }
        }
      }
    } catch (e) {
      console.log(
        `❌ [${day}일] 요소를 찾지 못함 (Row: ${currentRow}, Index: ${cellIndex})`
      );
    }
  }
}

module.exports = { selectServiceDays };

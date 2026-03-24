const { smartClick } = require("../click");

/**
 * 넥사크로 콤보박스 상하 전수 탐색 (test2.js 로직 복제 버전)
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} workFrame
 * @param {string} comboId 콤보박스 ID 키워드 (예: 'cmb_ctrYm')
 * @param {string} targetText 찾고자 하는 텍스트 (예: '2026년 4월')
 */
async function selectComboByText(page, workFrame, comboId, targetText) {
  const dropBtnSelector = `xpath///div[contains(@id, "${comboId}.dropbutton")]`;

  try {
    await workFrame.waitForSelector(dropBtnSelector, { timeout: 5000 });
    const dropBtn = await workFrame.$(dropBtnSelector);

    if (dropBtn) {
      console.log(`📅 [${comboId}] 드롭다운 클릭...`);
      await smartClick(page, workFrame, dropBtn);
      await new Promise((r) => setTimeout(r, 1000));

      const cleanTarget = targetText.replace(/\s+/g, "");
      let isFound = false;

      const directions = ["ArrowUp", "ArrowDown"];
      for (const direction of directions) {
        if (isFound) break;
        console.log(
          `🔍 [${direction === "ArrowUp" ? "위쪽" : "아래쪽"}] 탐색 시작...`
        );

        let lastValue = "";
        let sameCount = 0;

        while (true) {
          const currentValue = await workFrame.evaluate((id) => {
            const combo = document.querySelector(`div[id*="${id}"]`);
            if (!combo) return "";
            const input = combo.querySelector("input");
            return (input ? input.value : "") || combo.innerText.trim();
          }, comboId);

          const cleanCurrent = currentValue.replace(/\s+/g, "");

          if (currentValue) {
            if (cleanCurrent.includes(cleanTarget)) {
              isFound = true;
              console.log(`✅ 찾았습니다: ${currentValue}`);
              break;
            }
          }

          if (currentValue !== "" && lastValue === currentValue) {
            sameCount++;
            if (sameCount >= 3) break;
          } else {
            sameCount = 0;
          }

          lastValue = currentValue;
          await page.keyboard.press(direction);
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (isFound) {
        await page.keyboard.press("Enter");
        console.log(`✅ '${targetText}' 선택 확정 완료`);
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error(`❌ [${comboId}] 탐색 중 오류:`, err.message);
    return false;
  }
}

module.exports = { selectComboByText };

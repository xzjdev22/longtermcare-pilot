/**
 * 요소를 안전하게 클릭하는 공통 유틸리티
 */
async function smartClick(page, frame, element) {
  if (!element || !frame) return;

  await frame.evaluate((el) => {
    ["mousedown", "mouseup", "click"].forEach((evt) => {
      el.dispatchEvent(
        new MouseEvent(evt, { bubbles: true, cancelable: true, view: window })
      );
    });
  }, element);
}

module.exports = { smartClick };

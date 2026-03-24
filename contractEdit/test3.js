const readline = require("readline");
const { smartClick } = require("../utils/click"); // 기존 유틸리티 사용

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.toLowerCase());
    })
  );
}

/**
 * 모든 프레임을 뒤져서 요소를 찾는 헬퍼 (추가 버튼용)
 */
async function findElementInAllFrames(page, selector) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const el = await frame.$(selector);
      if (el) return { frame, el };
    } catch (e) {
      continue;
    }
  }
  return { frame: null, el: null };
}

async function selectMultiplePersons(page) {
  const targetNames = ["이복열", "추해숙"];
  const cleanTargets = targetNames.map((n) => n.replace(/\s+/g, ""));
  console.log(`👥 그리드 정밀 탐색 시작: ${targetNames.join(", ")}`);

  const frames = page.frames();
  let popupFrame = null;
  for (const frame of frames) {
    try {
      if (await frame.$('div[id*="grd_hdofcEggr"]')) {
        popupFrame = frame;
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!popupFrame) return console.error("❌ 팝업 프레임을 찾을 수 없습니다.");

  try {
    // ---------------------------------------------------------
    // [STEP 1] 기점 확보 (원복된 로직)
    // ---------------------------------------------------------
    const firstRowSelector = 'div[id*="grd_hdofcEggr.body.gridrow_0"]';
    const firstRow = await popupFrame.waitForSelector(firstRowSelector, {
      timeout: 5000,
    });
    if (firstRow) {
      await smartClick(page, popupFrame, firstRow);
      await new Promise((r) => setTimeout(r, 800));
    }

    let foundNames = new Set();
    let lastRowText = "";
    let sameCount = 0;

    // ---------------------------------------------------------

    // [STEP 2] 아래로 내려가며 물리적 체크박스 클릭

    // ---------------------------------------------------------

    for (let step = 0; step < 300; step++) {
      if (foundNames.size === targetNames.length) break;

      const currentRowData = await popupFrame.evaluate(() => {
        const focused =
          document.activeElement.closest(".GridRowControl") ||
          document.querySelector('.GridRowControl[status*="focused"]');

        return focused ? focused.innerText.trim() : "";
      });

      const cleanCurrent = currentRowData.replace(/\s+/g, "");

      for (let i = 0; i < targetNames.length; i++) {
        if (
          !foundNames.has(targetNames[i]) &&
          cleanCurrent.includes(cleanTargets[i])
        ) {
          console.log(`🎯 [${targetNames[i]}] 발견! 물리적 좌표 클릭 시도...`);

          // 현재 행에서 체크박스 영역(cell_X_0)의 좌표를 가져옴

          const iconSelector = `div[id*="grd_hdofcEggr"] div[id*="cell_"][id$="_0"]`;

          const iconElements = await popupFrame.$$(iconSelector);

          for (const icon of iconElements) {
            const isMatch = await icon.evaluate((el, name) => {
              const row = el.closest(".GridRowControl");

              return row && row.innerText.includes(name);
            }, targetNames[i]);

            if (isMatch) {
              const box = await icon.boundingBox();

              if (box) {
                // 마우스 이동 후 클릭 (사람처럼 보이게)

                await page.mouse.move(
                  box.x + box.width / 2,

                  box.y + box.height / 2
                );

                await page.mouse.down();

                await new Promise((r) => setTimeout(r, 100));

                await page.mouse.up();

                console.log(`✅ [${targetNames[i]}] 물리적 클릭 완료.`);

                foundNames.add(targetNames[i]);

                await new Promise((r) => setTimeout(r, 1000));

                break;
              }
            }
          }
        }
      }

      if (currentRowData !== "" && lastRowText === currentRowData) {
        sameCount++;

        if (sameCount >= 5) break;
      } else {
        sameCount = 0;
      }

      lastRowText = currentRowData;

      await page.keyboard.press("ArrowDown");

      await new Promise((r) => setTimeout(r, 300));
    }

    // ---------------------------------------------------------
    // [STEP 3] 추가 버튼(btn_add) CLI 재시도 (정밀 프레임 탐색 적용)
    // ---------------------------------------------------------
    if (foundNames.size > 0) {
      console.log(`✅ 탐색 종료. 추가 버튼을 검색합니다...`);

      // ID가 btn_add로 끝나는 요소를 모든 프레임에서 찾음
      const { frame: btnFrame, el: addBtn } = await findElementInAllFrames(
        page,
        'div[id$="btn_add"]'
      );

      if (addBtn) {
        const box = await addBtn.boundingBox();
        if (box) {
          let retry = true;
          while (retry) {
            console.log("🖱️ [추가] 버튼 물리적 좌표 클릭 시도...");
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2
            );
            await page.mouse.down();
            await new Promise((r) => setTimeout(r, 250)); // pushed 유도
            await page.mouse.up();

            // const answer = await askQuestion(
            //   "❓ 버튼이 눌렸습니까? 다시 클릭하려면 'y', 다음으로 넘어가려면 아무 키나 누르세요: "
            // );
            // if (answer !== "y") {
            //   retry = false;
            //   console.log("✅ 다음 단계로 이동합니다.");
            // }
            retry = false;
          }
        }
      } else {
        console.error("❌ 추가 버튼을 찾을 수 없습니다.");
      }
    }
  } catch (err) {
    console.error("❌ test3.js 실행 중 오류:", err.message);
  }
}

module.exports = { selectMultiplePersons };

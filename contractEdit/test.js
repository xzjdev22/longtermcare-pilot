const fs = require("fs");
const path = require("path");
const { smartClick } = require("../utils/click");
const { selectComboByText } = require("../utils/combo");

/**
 * 간단한 CSV 파서 (헤더 기반 객체 배열 생성)
 */
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });
    return row;
  });
}

/**
 * 콤보박스 옵션 목록에서 [이름]과 [서비스유형]이 모두 포함된 텍스트 항목을 찾아 클릭합니다.
 */
async function selectOptionByNameAndType(
  page,
  workFrame,
  comboId,
  name,
  serviceType,
  lastIndex = -1
) {
  try {
    // 1. 콤보박스 드롭다운 버튼 클릭 (목록 열기)
    const comboSelector = `xpath///div[contains(@id, "${comboId}")]`;
    const comboEl = await workFrame.$(comboSelector);
    if (!comboEl) {
      console.error(`❌ [실패] 콤보박스 요소를 찾을 수 없음 (ID: ${comboId})`);
      return { success: false, index: lastIndex };
    }

    await smartClick(page, workFrame, comboEl);
    await new Promise((r) => setTimeout(r, 400));

    // 2. 펼쳐진 드롭다운 리스트의 옵션 텍스트 항목 수집
    const optionsInfo = await workFrame.evaluate((cId) => {
      const popups = Array.from(
        document.querySelectorAll(
          'div[id*="combo"], div[id*="popup"], div[class*="combo"]'
        )
      );
      let items = [];

      for (const popup of popups) {
        const found = popup.querySelectorAll(
          'div[id*="item"], div[class*="item"], div[id*="body"] div'
        );
        if (found.length > 0) {
          items = Array.from(found)
            .map((el, idx) => ({
              text: el.innerText.trim(),
              index: idx,
              id: el.id,
            }))
            .filter((item) => item.text.length > 0);
          if (items.length > 0) break;
        }
      }
      return items;
    }, comboId);

    if (!optionsInfo || optionsInfo.length === 0) {
      console.error(`❌ [실패] [${comboId}] 드롭다운 옵션 목록 읽기 실패`);
      return { success: false, index: lastIndex };
    }

    // 3. 조건 매칭 탐색 ("이름"과 "서비스유형" 모두 포함)
    let targetOption = null;

    // A. 이전 탐색 위치(lastIndex)가 있으면 그 이후(아래 방향)부터 우선 검색
    if (lastIndex >= 0 && lastIndex < optionsInfo.length) {
      for (let i = lastIndex; i < optionsInfo.length; i++) {
        const item = optionsInfo[i];
        if (item.text.includes(name) && item.text.includes(serviceType)) {
          targetOption = item;
          break;
        }
      }
    }

    // B. 아래 방향에서 못 찾았거나 처음 탐색인 경우 맨 처음부터 재검색
    if (!targetOption) {
      for (let i = 0; i < optionsInfo.length; i++) {
        const item = optionsInfo[i];
        if (item.text.includes(name) && item.text.includes(serviceType)) {
          targetOption = item;
          break;
        }
      }
    }

    if (!targetOption) {
      console.error(
        `❌ [실패] 조건에 일치하는 옵션 없음 (이름: "${name}", 서비스: "${serviceType}")`
      );
      await page.keyboard.press("Escape");
      return { success: false, index: lastIndex };
    }

    // 4. 매칭된 옵션 텍스트로 선택 수행
    console.log(
      `🎯 매칭 항목 발견: "${targetOption.text}" (Index: ${targetOption.index})`
    );
    await selectComboByText(page, workFrame, comboId, targetOption.text);
    await new Promise((r) => setTimeout(r, 500));

    return {
      success: true,
      text: targetOption.text,
      index: targetOption.index,
    };
  } catch (err) {
    console.error(`❌ [실패] 콤보박스 선택 중 예외 발생: ${err.message}`);
    return { success: false, index: lastIndex };
  }
}

/**
 * 지정된 CSV 파일 직접 로드 후 수급자 콤보박스 컨트롤 테스트
 */
async function Test(page) {
  console.log("🚀 [Test] CSV 기반 콤보박스 수급자 선택 테스트 시작...");

  // CSV 파일 경로 지정
  const csvFilePath = path.join(
    process.cwd(),
    "data",
    "google_calendar_export - Google_Calendar_Export.csv"
  );

  let csvRows = [];
  try {
    csvRows = parseCSV(csvFilePath);
    console.log(`📂 CSV 로드 완료: 총 ${csvRows.length}개 행`);
  } catch (err) {
    return console.error(`❌ [실패] CSV 파일 읽기 오류: ${err.message}`);
  }

  if (csvRows.length === 0) {
    return console.error("❌ [실패] CSV 파일 데이터가 비어 있습니다.");
  }

  // 작업 프레임 찾기
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("framesetWork") || f.name().includes("winNPA03020000")
  );

  if (!workFrame) {
    for (const frame of frames) {
      try {
        if (await frame.$('xpath///div[contains(@id, "npia107p01")]')) {
          workFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  if (!workFrame) {
    return console.error(
      "❌ [실패] 메인 작업 프레임(workFrame)을 찾을 수 없습니다."
    );
  }

  let currentSelectedName = null;
  let lastSelectedIndex = -1;

  for (let i = 0; i < csvRows.length; i++) {
    const row = csvRows[i];

    // CSV의 컬럼명 파싱 (CSV 헤더 형태에 맞춰 필요시 컬럼명 변경)
    // 예: 강숙자,2026-08-07,... 인 경우 첫 번째 컬럼이 이름
    const name = row["이름"] || row["수급자"] || Object.values(row)[0] || "";
    // CSV 헤더나 비고/서비스 컬럼에서 '방문목욕', '방문요양' 추출
    const rawLine = Object.values(row).join(" ");
    const serviceType = rawLine.includes("방문목욕") ? "방문목욕" : "방문요양";

    if (!name) {
      console.error(`❌ [실패] [Row ${i + 1}] 이름 데이터를 추출하지 못함`);
      continue;
    }

    console.log(
      `\n📄 [Row ${i + 1}/${csvRows.length}] ${name} (${serviceType})`
    );

    // 1. 이전 행과 이름이 동일하면 조작 스킵
    if (currentSelectedName === name) {
      console.log(`⏭️ 동일한 수급자 [${name}] - 콤보박스 선택 유지`);
      continue;
    }

    // 2. 이름 변경 시 cmb_obj 탐색 및 선택
    console.log(
      `🔄 수급자 변경 감지: [${currentSelectedName || "없음"}] -> [${name}]`
    );

    const result = await selectOptionByNameAndType(
      page,
      workFrame,
      "cmb_obj",
      name,
      serviceType,
      lastSelectedIndex
    );

    if (result.success) {
      currentSelectedName = name;
      lastSelectedIndex = result.index;
      console.log(`✅ [성공] [${name}] 선택 완료`);
    } else {
      console.error(`❌ [실패] [Row ${i + 1}] [${name}] 콤보박스 선택 실패`);
    }
  }

  console.log("\n🏁 테스트 종료.");
}

module.exports = { Test, selectOptionByNameAndType };

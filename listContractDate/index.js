/**
 * extractGridDataToCSV.js (Puppeteer 키보드/휠 이벤트 기반 스크롤 수집)
 */
const fs = require("fs");
const path = require("path");

async function findWorkFrame(page) {
  const frames = page.frames();
  let workFrame = frames.find(
    (f) =>
      f.name().includes("framesetWork") || f.name().includes("winNPA03020000"),
  );
  if (!workFrame) {
    for (const frame of frames) {
      try {
        if (await frame.$('xpath///div[contains(@id, "grd_pofPlnppList")]')) {
          workFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }
  return workFrame || page;
}

async function runListContractDate(
  page,
  gridId = "grd_pofPlnppList",
  outputFileName = "nexa_grid_export.csv",
) {
  console.log(
    `🔍 [CSV 추출] 그리드(${gridId}) 이벤트 기반 스크롤 전수 추출 시작...`,
  );

  const targetContext = await findWorkFrame(page);

  // 1. 헤더 먼저 추출
  const headers = await targetContext.evaluate((targetGridId) => {
    const gridRoot = document.querySelector(`[id*="${targetGridId}"]`);
    if (!gridRoot) return [];

    const headCells = Array.from(
      gridRoot.querySelectorAll('.head [id*="cell_-1_"]'),
    );
    const hdrs = [];
    headCells.forEach((cell) => {
      const textDiv = cell.querySelector('[id*=":text"]');
      let text = (textDiv ? textDiv.innerText : cell.innerText)
        .trim()
        .replace(/\s+/g, " ");
      if (text && !hdrs.includes(text)) {
        hdrs.push(text);
      }
    });
    return hdrs;
  }, gridId);

  if (headers.length === 0) {
    throw new Error("그리드 헤더를 찾을 수 없습니다.");
  }

  // 2. 그리드 엘리먼트 핸들 확보 (키보드/마우스 인터랙션용)
  const gridHandle = await targetContext.$(`[id*="${gridId}"]`);
  if (gridHandle) {
    await gridHandle.click(); // 그리드 포커스
  }

  let previousRowCount = 0;
  let stagnantCount = 0;
  const rowMap = {};

  // 3. 스크롤을 내리며 누적 수집
  for (let step = 0; step < 50; step++) {
    const currentBatch = await targetContext.evaluate((targetGridId) => {
      const gridRoot = document.querySelector(`[id*="${targetGridId}"]`);
      if (!gridRoot) return {};

      const bodyCells = gridRoot.querySelectorAll(
        '.body [id*="cell_"], .GridBandControl.body [id*="cell_"]',
      );
      const batchMap = {};

      bodyCells.forEach((cell) => {
        const idMatch = cell.id.match(/cell_(\d+)_(\d+)/);
        if (idMatch) {
          const rowIndex = idMatch[1];
          const colIndex = parseInt(idMatch[2], 10);
          if (!batchMap[rowIndex]) batchMap[rowIndex] = [];

          const textDiv = cell.querySelector('[id*=":text"]');
          let text = textDiv ? textDiv.innerText : cell.innerText;
          batchMap[rowIndex][colIndex] = text
            ? text.trim().replace(/\s+/g, " ")
            : "";
        }
      });
      return batchMap;
    }, gridId);

    let newRowsAdded = false;
    for (const [rowIndex, cols] of Object.entries(currentBatch)) {
      if (!rowMap[rowIndex]) {
        rowMap[rowIndex] = cols;
        newRowsAdded = true;
      }
    }

    const currentRowCount = Object.keys(rowMap).length;
    if (currentRowCount === previousRowCount) {
      stagnantCount++;
      if (stagnantCount >= 3) {
        break; // 더 이상 새로운 행이 로드되지 않음
      }
    } else {
      stagnantCount = 0;
      previousRowCount = currentRowCount;
    }

    // 넥사크로 가상 스크롤을 강제로 반응시키기 위해 Wheel 이벤트 및 PageDown 동시 실행
    await targetContext.evaluate((targetGridId) => {
      const gridRoot = document.querySelector(`[id*="${targetGridId}"]`);
      if (gridRoot) {
        const wheelEvent = new WheelEvent("wheel", {
          deltaY: 500,
          bubbles: true,
          cancelable: true,
        });
        gridRoot.dispatchEvent(wheelEvent);
      }
    }, gridId);

    // Puppeteer 키보드 PageDown 입력
    await page.keyboard.press("PageDown");
    await new Promise((r) => setTimeout(r, 300)); // 렌더링 대기
  }

  // 4. 데이터 정렬 및 B열(인덱스 1) 제외 처리
  const sortedRowIndices = Object.keys(rowMap).sort(
    (a, b) => Number(a) - Number(b),
  );

  const rows = sortedRowIndices.map((idx) => {
    const rawRow = rowMap[idx];
    const shiftedRow = [];
    for (let i = 0; i < rawRow.length; i++) {
      if (i === 1) continue; // B열 스킵
      shiftedRow.push(rawRow[i] !== undefined ? rawRow[i] : "");
    }
    return shiftedRow;
  });

  // 5. CSV 포맷 생성 및 저장
  let csvContent = "\uFEFF";
  csvContent +=
    headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

  rows.forEach((row) => {
    const lineData = headers.map((_, i) => {
      const val = row[i] || "";
      return `"${val.toString().replace(/"/g, '""')}"`;
    });
    csvContent += lineData.join(",") + "\n";
  });

  const dirPath = path.join(process.cwd(), "data");
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  const outputPath = path.join(dirPath, outputFileName);
  fs.writeFileSync(outputPath, csvContent, "utf-8");

  console.log(
    `✅ [CSV 추출 완료] 저장 경로: ${outputPath} (총 ${rows.length}개 행 수집)`,
  );
  return outputPath;
}

module.exports = { runListContractDate };

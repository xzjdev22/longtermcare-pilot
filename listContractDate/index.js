/**
 * extractGridDataToCSV.js (행 인덱스 고정 문제 해결 및 전수 수집 버전)
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
  console.log(`🔍 [CSV 추출] 그리드(${gridId}) 스크롤 연동 전수 수집 시작...`);

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

  // 2. 그리드 포커스
  const gridHandle = await targetContext.$(`[id*="${gridId}"]`);
  if (gridHandle) {
    await gridHandle.click();
  }

  const collectedRows = [];
  const seenSignatures = new Set(); // 중복 데이터 방지용 고유 시그니처 (행의 데이터 조합)
  let stagnantCount = 0;

  // 3. 스크롤을 조금씩 내리면서 현재 DOM에 나타나는 데이터를 순서대로 누적
  for (let step = 0; step < 100; step++) {
    const currentBatch = await targetContext.evaluate((targetGridId) => {
      const gridRoot = document.querySelector(`[id*="${targetGridId}"]`);
      if (!gridRoot) return [];

      const bodyCells = gridRoot.querySelectorAll(
        '.body [id*="cell_"], .GridBandControl.body [id*="cell_"]',
      );
      const rowMap = {};

      bodyCells.forEach((cell) => {
        const idMatch = cell.id.match(/cell_(\d+)_(\d+)/);
        if (idMatch) {
          const rowIndex = Number(idMatch[1]);
          const colIndex = parseInt(idMatch[2], 10);
          if (!rowMap[rowIndex]) rowMap[rowIndex] = [];

          const textDiv = cell.querySelector('[id*=":text"]');
          let text = textDiv ? textDiv.innerText : cell.innerText;
          rowMap[rowIndex][colIndex] = text
            ? text.trim().replace(/\s+/g, " ")
            : "";
        }
      });

      // 인덱스 순으로 정렬하여 배열로 변환
      const sortedIndices = Object.keys(rowMap).sort(
        (a, b) => Number(a) - Number(b),
      );
      return sortedIndices.map((idx) => rowMap[idx]);
    }, gridId);

    let newRowsAdded = false;

    currentBatch.forEach((rawRow) => {
      if (!rawRow || rawRow.length === 0) return;

      // B열(인덱스 1) 제외하고 시그니처 생성 (중복 판단용)
      const shiftedRow = [];
      for (let i = 0; i < rawRow.length; i++) {
        if (i === 1) continue; // B열 스킵
        shiftedRow.push(rawRow[i] !== undefined ? rawRow[i] : "");
      }

      // 완전히 빈 행이 아닌 경우에만 처리
      const isNotEmpty = shiftedRow.some((val) => val !== "");
      if (!isNotEmpty) return;

      const signature = shiftedRow.join("||");
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        collectedRows.push(shiftedRow);
        newRowsAdded = true;
      }
    });

    if (!newRowsAdded) {
      stagnantCount++;
      if (stagnantCount >= 4) {
        break; // 더 이상 새로운 데이터가 안 나오면 종료
      }
    } else {
      stagnantCount = 0;
    }

    // 넥사크로 가상 스크롤을 움직이기 위해 휠 이벤트 발생 및 PageDown
    await targetContext.evaluate((targetGridId) => {
      const gridRoot = document.querySelector(`[id*="${targetGridId}"]`);
      if (gridRoot) {
        const wheelEvent = new WheelEvent("wheel", {
          deltaY: 150,
          bubbles: true,
          cancelable: true,
        });
        gridRoot.dispatchEvent(wheelEvent);
      }
    }, gridId);

    await page.keyboard.press("PageDown");
    await new Promise((r) => setTimeout(r, 250));
  }

  // 4. CSV 포맷 생성 및 저장
  let csvContent = "\uFEFF";
  csvContent +=
    headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

  collectedRows.forEach((row) => {
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
    `✅ [CSV 추출 완료] 저장 경로: ${outputPath} (총 ${collectedRows.length}개 행 수집)`,
  );
  return outputPath;
}

module.exports = { runListContractDate };

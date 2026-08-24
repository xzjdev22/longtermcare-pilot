/**
 * extractGridDataToCSV.js (최초 원본 기반 + 요청사항 반영)
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
  console.log(`🔍 [CSV 추출] 그리드(${gridId}) 데이터 파싱 시작...`);

  const targetContext = await findWorkFrame(page);

  const rawData = await targetContext.evaluate((targetGridId) => {
    const gridRoot = document.querySelector(`[id*="${targetGridId}"]`);
    if (!gridRoot) return { error: "그리드를 찾을 수 없습니다." };

    // 1. 헤더 추출: 이미 있는 이름이거나 빈 문자열이면 건너뛰기
    const headCells = Array.from(
      gridRoot.querySelectorAll('.head [id*="cell_-1_"]'),
    );
    const headers = [];

    headCells.forEach((cell) => {
      const textDiv = cell.querySelector('[id*=":text"]');
      let text = (textDiv ? textDiv.innerText : cell.innerText)
        .trim()
        .replace(/\s+/g, " ");

      // 빈 문자열이 아니고, 기존 headers에 없는 경우에만 추가 (중복 및 빈값 차단)
      if (text && !headers.includes(text)) {
        headers.push(text);
      }
    });

    // 2. 바디(데이터) 행 추출
    const bodyCells = gridRoot.querySelectorAll(
      '.body [id*="cell_"], .GridBandControl.body [id*="cell_"]',
    );
    const rowMap = {};

    bodyCells.forEach((cell) => {
      const idMatch = cell.id.match(/cell_(\d+)_(\d+)/);
      if (idMatch) {
        const rowIndex = idMatch[1];
        const colIndex = parseInt(idMatch[2], 10);
        if (!rowMap[rowIndex]) rowMap[rowIndex] = [];

        const textDiv = cell.querySelector('[id*=":text"]');
        let text = textDiv ? textDiv.innerText : cell.innerText;
        rowMap[rowIndex][colIndex] = text
          ? text.trim().replace(/\s+/g, " ")
          : "";
      }
    });

    // 3. 데이터 정렬 및 열 당기기 (B열 제외하고 C열부터 한 칸씩 앞으로 당김)
    const sortedRowIndices = Object.keys(rowMap).sort(
      (a, b) => Number(a) - Number(b),
    );
    const rows = sortedRowIndices.map((idx) => {
      const rawRow = rowMap[idx];
      const shiftedRow = [];

      // rawRow[0] = A열(NO) 그대로 둠
      // rawRow[1] = B열(빈값)은 건너뜀
      // rawRow[2]부터 끝까지를 앞으로 한 칸씩 당김 (C열 -> B열 위치로)
      for (let i = 0; i < rawRow.length; i++) {
        if (i === 1) continue; // B열 스킵
        shiftedRow.push(rawRow[i] !== undefined ? rawRow[i] : "");
      }

      return shiftedRow;
    });

    return { headers, rows };
  }, gridId);

  if (rawData.error) throw new Error(rawData.error);

  // 4. CSV 포맷 생성 및 저장
  let csvContent = "\uFEFF";
  csvContent +=
    rawData.headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

  rawData.rows.forEach((row) => {
    // 헤더 개수와 컬럼 개수 맞추기
    const lineData = rawData.headers.map((_, i) => {
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
    `✅ [CSV 추출 완료] 저장 경로: ${outputPath} (총 ${rawData.rows.length}개 행 수집)`,
  );
  return outputPath;
}

module.exports = { runListContractDate };

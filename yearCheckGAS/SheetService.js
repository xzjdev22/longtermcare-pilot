/**
 * @filename SheetService.js
 */

/**
 * 특정 시트의 기존 데이터를 파싱하여 수급자 이름을 키로 하는 맵 객체로 캐싱합니다.
 * @param {Sheet} sheet - 메타데이터를 추출할 대상 스프레드시트 탭
 * @returns {Map} 수급자 이름을 키로 하고 기존 작성일자, 색상, 링크, 메모 등을 담은 객체를 반환하는 맵
 */
function cacheSheetMetadata(sheet) {
  const map = new Map(); // 수급자별 데이터를 저장할 맵 객체 초기화
  if (!sheet) return map; // 시트 객체가 존재하지 않으면 빈 맵 반환

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return map; // 데이터 영역(5행 헤더 이후)이 없으면 빈 맵 반환

  const range = sheet.getRange(6, 1, lastRow - 5, 20);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const richTexts = range.getRichTextValues();
  const notes = range.getNotes();

  // 데이터 행들을 순회하며 수급자 이름 기준의 메타데이터를 추출하여 맵에 적재
  values.forEach((r, i) => {
    // 수급자명(Col C / 수급자명)에서 특수문자와 공백을 제거하여 정규화된 이름 추출
    const name = r[2]
      ?.toString()
      .replace(/\(.*?\)/g, "")
      .replace(/[\r\n]+/g, "")
      .replace(/\s+/g, "")
      .trim();

    // 정규화된 수급자 이름이 유효한 경우에만 맵에 데이터 객체 등록
    if (name) {
      map.set(name, {
        contractDate: {
          // Col D: 표준약관 작성일자
          text: r[3],
          color: backgrounds[i][3],
          link: richTexts[i][3]?.getLinkUrl(),
        },
        planEndDate: { text: r[4], color: backgrounds[i][4] }, // Col E: 급여제공계획서 종료일자
        resultEvalDate: {
          // Col O: 결과평가 작성일자
          text: r[14],
          color: backgrounds[i][14],
          link: richTexts[i][14]?.getLinkUrl(),
        },
        planStartDate: { text: r[15], color: backgrounds[i][15] }, // Col P: 급여제공계획 적용기간(시작)
        planEndDateRef: { text: r[16], color: backgrounds[i][16] }, // Col Q: 급여제공계획 적용기간(종료)
        contractStartDate: {
          // Col R: 인정유효기간(시작)
          text: r[17],
          color: backgrounds[i][17],
          note: notes[i][17],
          link: richTexts[i][17]?.getLinkUrl(),
        },
        contractEndDate: {
          // Col S: 인정유효기간(종료)
          text: r[18],
          color: backgrounds[i][18],
          note: notes[i][18],
          link: richTexts[i][18]?.getLinkUrl(),
        },
        remark: { text: r[19], color: backgrounds[i][19], note: notes[i][19] }, // Col T: 비고
      });
    }
  });

  return map;
}

/**
 * 새로 생성된 월별 결과 시트 상단의 제어 영역(A1:C3)과 테이블 헤더(Row 5)의 레이아웃을 세팅합니다.
 * @param {Sheet} sheet - 레이아웃을 적용할 대상 시트
 * @param {string} c2Val - 전년도 시트 URL 값
 * @param {string} c3Val - 구글 드라이브 폴더 URL 값
 */
function setupHeaderAndControls(sheet, c2Val, c3Val) {
  const now = new Date();
  const dateStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const timeStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "HH:mm:ss",
  );
  const displayValue = `${dateStr}\n${timeStr}`;

  sheet.getRange("A1").setValue("케어포");
  sheet.getRange("B1").setValue("연동일시");

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([displayValue, "업데이트"], true)
    .build();

  sheet.getRange("C1").setDataValidation(rule).setValue(displayValue);
  sheet.getRange("C1").setWrap(true);

  sheet.getRange("A2").setValue("전년도");
  sheet.getRange("B2").setValue("시트");
  sheet.getRange("C2").setValue(c2Val);

  sheet.getRange("A3").setValue("수급자");
  sheet.getRange("B3").setValue("기본자료");
  sheet.getRange("C3").setValue(c3Val);

  sheet
    .getRange("A1:B1")
    .setBackground("#38761d")
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");
  sheet
    .getRange("A2:B2")
    .setBackground(COLOR_WHITE)
    .setFontColor("#000000")
    .setFontWeight("bold");
  sheet
    .getRange("A3:B3")
    .setBackground("#e69138")
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");

  sheet
    .getRange("C1:C3")
    .setBackground(COLOR_WHITE)
    .setFontColor("#000000")
    .setFontWeight("normal");

  sheet.getRange("C1").setFontSize(10);
  sheet.getRange("C2:C3").setFontSize(12);

  sheet.getRange("A1:A3").setHorizontalAlignment("right");
  sheet.getRange("B1:B3").setHorizontalAlignment("left");
  sheet.getRange("C1:C3").setHorizontalAlignment("center");
  sheet.getRange("C1").setVerticalAlignment("middle");

  sheet
    .getRange("A1:B3")
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      "black",
      SpreadsheetApp.BorderStyle.SOLID,
    );
  sheet
    .getRange("C1:C3")
    .setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      "black",
      SpreadsheetApp.BorderStyle.SOLID,
    );

  const headers = [
    "No.", // Col A
    "현황", // Col B
    "수급자명", // Col C
    "표준약관\n작성일자", // Col D
    "급여제공계획서\n종료일자", // Col E
    "낙상위험도\n(상반기)", // Col F
    "욕창위험도\n(상반기)", // Col G
    "인지기능\n(상반기)", // Col H
    "낙상위험도\n(하반기)", // Col I
    "욕창위험도\n(하반기)", // Col J
    "인지기능\n(하반기)", // Col K
    "욕구사정", // Col L
    "급여제공계획서\n작성일자", // Col M
    "급여제공계획서\n종류", // Col N
    "결과평가\n작성일자", // Col O
    "급여제공계획\n적용기간(시작)", // Col P
    "급여제공계획\n적용기간(종료)", // Col Q
    "인정유효기간\n(시작)", // Col R
    "인정유효기간\n(종료)", // Col S
    "비고", // Col T
  ];

  const headerRange = sheet.getRange(5, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setBackground(COLOR_TITLE)
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold")
    .setFontSize(10);
  headerRange.setHorizontalAlignment("center").setVerticalAlignment("middle");

  sheet
    .getDataRange()
    .setFontSize(12)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  headerRange.setFontSize(10);
  sheet.getRange("C1").setFontSize(10).setWrap(true);

  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(3);

  const maxCols = sheet.getMaxColumns();
  // 스프레드시트의 전체 열 개수가 정의된 헤더보다 많을 경우 불필요한 열 삭제
  if (maxCols > headers.length) {
    sheet.deleteColumns(headers.length + 1, maxCols - headers.length);
  }

  sheet.setColumnWidth(1, 48);
  sheet.setColumnWidth(2, 64);
  sheet.setColumnWidth(3, 96);
  sheet.setColumnWidth(4, 104);
  sheet.setColumnWidth(5, 104);

  // 6부터 11번 열(위험도 및 인지기능 평가 항목들)의 너비를 일괄 설정하는 반복문
  for (let col = 6; col <= 11; col++) {
    sheet.setColumnWidth(col, 88);
  }

  // 12부터 19번 열(계획서 및 유효기간 관련 항목들)의 너비를 일괄 설정하는 반복문
  for (let col = 12; col <= 19; col++) {
    sheet.setColumnWidth(col, 104);
  }
  sheet.setColumnWidth(20, 320);
}

/**
 * 파이프라인 중단 또는 예외 발생 시 C1 셀의 드롭다운 상태를 초기값으로 복구합니다.
 * @param {Sheet} sheet - 상태를 초기화할 대상 시트
 */
function resetC1Dropdown(sheet) {
  const sheetName = sheet.getName();
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([sheetName, "업데이트"], true)
    .build();
  sheet.getRange("C1").setDataValidation(rule).setValue(sheetName);
}

/**
 * 생성된 시트들의 탭 순서를 정렬하고, 불필요한 과거 시트 정리 및 명칭을 관리합니다.
 * @param {Spreadsheet} targetSs - 대상 스프레드시트 문서 객체
 * @param {string} currentSheetName - 새로 생성되어 최우선 배치할 시트 이름
 */
function reorderAndCleanSheets(targetSs, currentSheetName) {
  const currentSheet = targetSs.getSheetByName(currentSheetName);
  const careforSheet = targetSs.getSheetByName(SHEET_NAME_CAREFOR);
  const logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);

  const sheets = targetSs.getSheets();
  // 모든 시트를 순회하며 기존에 붙어있던 '(직전시트)' 명칭 접두사를 제거하여 초기화
  sheets.forEach((s) => {
    const name = s.getName();
    // 시트 이름이 '(직전시트)'로 시작하는 경우 접두사를 제거하고 원래 이름으로 복원
    if (name.startsWith("(직전시트)")) {
      s.setName(name.replace("(직전시트)", "").trim());
    }
  });

  // 현재 생성된 시트, 케어포 연동 시트, Log 시트를 제외한 가장 최근의 결과 시트를 탐색하여 직전 시트로 지정
  let prevTargetSheet = targetSs
    .getSheets()
    .find(
      (s) =>
        s.getName() !== currentSheetName &&
        s.getName() !== SHEET_NAME_CAREFOR &&
        s.getName() !== SHEET_NAME_LOG,
    );

  // 탐색된 직전 시트가 존재할 경우 이름 앞에 '(직전시트) ' 접두사를 추가하여 구분
  if (prevTargetSheet) {
    prevTargetSheet.setName("(직전시트) " + prevTargetSheet.getName());
  }

  // 새로 생성된 결과 시트가 존재하는 경우 첫 번째 탭 위치로 이동
  if (currentSheet) {
    targetSs.setActiveSheet(currentSheet);
    targetSs.moveActiveSheet(1);
  }
  // 케어포 연동 원본 시트가 존재하는 경우 두 번째 탭 위치로 이동
  if (careforSheet) {
    targetSs.setActiveSheet(careforSheet);
    targetSs.moveActiveSheet(2);
  }
  // 직전 시트가 존재하는 경우 세 번째 탭 위치로 이동
  if (prevTargetSheet) {
    targetSs.setActiveSheet(prevTargetSheet);
    targetSs.moveActiveSheet(3);
  }
  // 로그 시트가 존재하는 경우 네 번째 탭 위치로 이동
  if (logSheet) {
    targetSs.setActiveSheet(logSheet);
    targetSs.moveActiveSheet(4);
  }

  const now = new Date();
  const dateStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const timeStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "HH:mm:ss",
  );
  const displayValue = `${dateStr}\n${timeStr}`;

  // 현재 시트가 존재하면 C1 셀의 검증 규칙 및 날짜/시간 표시값 갱신
  if (currentSheet) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([displayValue, "업데이트"], true)
      .build();
    currentSheet
      .getRange("C1")
      .setDataValidation(rule)
      .setValue(displayValue)
      .setWrap(true)
      .setFontSize(10);
  }

  // 직전 시트가 존재하면 C1 셀의 드롭다운 명칭을 순수 시트 이름 기준으로 갱신
  if (prevTargetSheet) {
    const cleanName = prevTargetSheet
      .getName()
      .replace("(직전시트)", "")
      .trim();
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([cleanName, "업데이트"], true)
      .build();
    prevTargetSheet
      .getRange("C1")
      .setDataValidation(rule)
      .setValue(cleanName)
      .setWrap(true)
      .setFontSize(10);
  }

  // 현재 시트의 최대 행과 실제 데이터가 채워진 마지막 행을 비교하여 불필요한 빈 행 제거
  if (currentSheet) {
    const maxRows = currentSheet.getMaxRows();
    const lastRow = currentSheet.getLastRow();
    // 최대 행이 실제 데이터 행보다 클 경우에만 초과된 빈 행들을 일괄 삭제
    if (maxRows > lastRow) {
      currentSheet.deleteRows(lastRow + 1, maxRows - lastRow);
    }
  }

  const allSheets = targetSs.getSheets();
  const pastSheets = [];

  // 4번째 탭(인덱스 4, 즉 결과 시트/케어포/직전시트/로그 이후)부터의 과거 월별 시트들을 추출하는 반복문
  for (let i = 4; i < allSheets.length; i++) {
    pastSheets.push(allSheets[i]);
  }

  // 추출된 과거 시트들을 이름순으로 정렬
  pastSheets.sort((a, b) => a.getName().localeCompare(b.getName()));

  // 보관 기준 개수(2개)를 초과하는 오래된 과거 시트들을 삭제하는 분기 및 반복문
  if (pastSheets.length > 2) {
    // 2번째 인덱스부터 끝까지 순회하며 초과된 오래된 과거 시트들을 문서에서 영구 삭제
    for (let i = 2; i < pastSheets.length; i++) {
      targetSs.deleteSheet(pastSheets[i]);
    }
  }

  targetSs.setActiveSheet(currentSheet);
}

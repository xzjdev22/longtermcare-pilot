/**
 * ==============================================================================
 * Google Apps Script - 장기요양기관 케어포 연동 및 서류 관리 자동화
 * 명세서 버전: 2026-08-17 15:29:54
 * ==============================================================================
 */

// ==============================================================================
// 전역 상수 및 색상 정의 (Strict Color Rules)
// ==============================================================================
const COLOR_POSITIVE = "#d9ead3"; // 긍정 (수급중, 정상 작성, 연동 성공 등)
const COLOR_NEGATIVE = "#f4ccd0"; // 부정 (계약해지, 불명, 미작성, 오류, 갱신필요 등)
const COLOR_NEUTRAL = "#cccccc"; // 중립 (보류, 헤더, 작성 의무기간 외 미작성 등)
const COLOR_WHITE = "#ffffff";
const COLOR_TITLE = "#34495e";

const SHEET_NAME_CAREFOR = "케어포연동";
const SHEET_NAME_LOG = "Log";
const PROP_KEY_RUNNING = "CAREFOR_PIPELINE_RUNNING";

// ==============================================================================
// 메인 컨트롤러 및 온에디트 트리거
// ==============================================================================

/**
 * C1 셀 변경 감지 및 자동 실행 트리거 (onEdit)
 * - 프로그램적 값 변경으로 인한 재귀 호출(중복 실행) 방지 안전 플래그(PropertiesService) 적용
 * - C1이 "업데이트"로 변경된 경우 Confirm 팝업 출력
 */
function onEdit(e) {
  if (!e) return;
  const range = e.range;
  const sheet = range.getSheet();

  // 첫 번째 시트(Index 1, 1번 위치)의 C1 셀이 "업데이트"로 변경될 때 동작
  if (
    sheet.getIndex() === 1 &&
    range.getA1Notation() === "C1" &&
    e.value === "업데이트"
  ) {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROP_KEY_RUNNING) === "true") {
      return; // 이미 실행 중인 경우 중복 실행 방지
    }

    try {
      props.setProperty(PROP_KEY_RUNNING, "true");
      runCareforPipeline(e.source, sheet);
    } finally {
      props.setProperty(PROP_KEY_RUNNING, "false");
    }
  }
}

/**
 * 수동 실행용 및 온에디트 연계 메인 함수
 */
function runCareforPipeline(ss, currentActiveSheet) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "케어포 연동 진행",
    "하단의 케어포연동 시트와 구글드라이브(표준약관, 급여제공계획서, 급여제공 결과평가)가 모두 최신이어야 합니다. 진행하시겠습니까?",
    ui.ButtonSet.YES_NO,
  );

  const targetSs = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheets = targetSs.getSheets();
  const prevSheet = sheets.length > 0 ? sheets[0] : null;

  if (response !== ui.Button.YES) {
    // 취소 시 C1 셀을 "업데이트" 항목이 포함된 데이터 유효성 검사 규칙을 유지하면서 현재 시트 이름 설정 대신 초기 상태 원복
    if (currentActiveSheet) {
      resetC1Dropdown(currentActiveSheet);
    }
    return;
  }

  const logs = [];
  const now = new Date();
  const nowStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss",
  );

  try {
    // --------------------------------------------------------------------------
    // Step 1: 유효성 검사 및 Log 시트 점검
    // --------------------------------------------------------------------------
    const prevC2Url = prevSheet
      ? (prevSheet.getRange("C2").getValue()?.toString().trim() ?? "")
      : "";
    const prevC3Url = prevSheet
      ? (prevSheet.getRange("C3").getValue()?.toString().trim() ?? "")
      : "";

    if (!prevC2Url) {
      addLog(
        logs,
        "-",
        2,
        "C2(전년도시트URL)",
        "URL 미입력",
        "전년도 시트 URL이 입력되지 않았습니다.",
      );
    }
    if (!prevC3Url) {
      addLog(
        logs,
        "-",
        3,
        "C3(드라이브URL)",
        "URL 미입력",
        "구글 드라이브 URL이 입력되지 않았습니다.",
      );
    }

    // Log 시트 초기화/생성
    let logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);
    if (!logSheet) {
      logSheet = targetSs.insertSheet(SHEET_NAME_LOG);
    } else {
      logSheet.clear();
    }
    logSheet.appendRow([
      "발생일시",
      "수급자명",
      "행 번호(Row)",
      "열/항목명(Column)",
      "오류/이슈 구분",
      "상세 내용 및 조치 필요사항",
    ]);
    logSheet
      .getRange(1, 1, 1, 6)
      .setBackground(COLOR_TITLE)
      .setFontColor(COLOR_WHITE)
      .setFontWeight("bold");

    // --------------------------------------------------------------------------
    // Step 2: 드라이브 전체 파일 구조 메모리 캐싱 (성능 최적화 - 필수)
    // --------------------------------------------------------------------------
    // [Step 2] DriveApp API 최소화를 위해 C3 폴더 하위 전체 파일을 JS Map에 일괄 Caching
    const driveFileMap = new Map();
    if (prevC3Url) {
      try {
        const folderId = extractDriveIdFromUrl(prevC3Url);
        if (folderId) {
          const rootFolder = DriveApp.getFolderById(folderId);
          cacheDriveFilesRecursive(rootFolder, driveFileMap);
        } else {
          addLog(
            logs,
            "-",
            3,
            "C3(드라이브URL)",
            "URL 파싱 오류",
            "구글 드라이브 Folder ID를 추출할 수 없습니다.",
          );
        }
      } catch (err) {
        addLog(
          logs,
          "-",
          3,
          "C3(드라이브URL)",
          "드라이브 접근 오류",
          err.message,
        );
      }
    }

    // --------------------------------------------------------------------------
    // Step 3: 케어포연동 시트 데이터 및 직전/전년도 시트 캐싱
    // --------------------------------------------------------------------------
    // [Step 3] 케어포연동 시트 원천 데이터 래핑 및 직전 시트 메타데이터 Map 생성
    const careforSheet = targetSs.getSheetByName(SHEET_NAME_CAREFOR);
    const careforData = careforSheet
      ? careforSheet.getDataRange().getValues()
      : [];

    // 직전 시트 수급자별 데이터 Caching Map
    const prevSheetMap = cacheSheetMetadata(prevSheet);

    // 전년도 시트 수급자별 데이터 Caching Map
    let prevYearSheetMap = new Map();
    if (prevC2Url) {
      try {
        const prevYearSs = SpreadsheetApp.openByUrl(prevC2Url);
        const prevYearSheet = prevYearSs.getSheets()[0];
        prevYearSheetMap = cacheSheetMetadata(prevYearSheet);
      } catch (err) {
        addLog(
          logs,
          "-",
          2,
          "C2(전년도시트URL)",
          "전년도 시트 접근 오류",
          err.message,
        );
      }
    }

    // --------------------------------------------------------------------------
    // Step 4: 수급자별 데이터 연산 (try-catch 기반 예외 분리 및 완주 보장)
    // --------------------------------------------------------------------------
    // [Step 4] 수급자 데이터 파싱 및 항목별 비즈니스 로직 적용 (ES6+ 배열 메서드 활용)
    const careforRows = careforData.slice(10); // 11행부터 데이터 시작 (Index 10)

    const processedRows = [];
    careforRows.forEach((row, idx) => {
      const rawNo = row[0];
      // A열 No. 가 유효한 정수가 아니거나 빈값이면 데이터 종료로 인식
      if (!rawNo || isNaN(parseInt(rawNo, 10))) {
        return;
      }

      const rowIndex = 11 + idx; // 실제 시트 행 번호
      const rawStatus = row[1]?.toString().trim() ?? "";
      const rawName = row[2]?.toString().trim() ?? "";

      // 수급자명 정제: '(김효정)' 괄호 제거 및 공백/개행 정제
      const name = rawName
        .replace(/\(.*?\)/g, "")
        .replace(/[\r\n]+/g, "")
        .replace(/\s+/g, "")
        .trim();

      if (!name) {
        addLog(
          logs,
          "미상",
          rowIndex,
          "수급자명",
          "필수 데이터 누락",
          "수급자명이 결손되어 해당 행을 스킵합니다.",
        );
        return;
      }

      // 현황 색상 설정
      let statusText = "불명";
      let statusColor = COLOR_NEGATIVE;
      if (rawStatus.includes("수급중")) {
        statusText = "수급중";
        statusColor = COLOR_POSITIVE;
      } else if (rawStatus.includes("계약해지")) {
        statusText = "계약해지";
        statusColor = COLOR_NEGATIVE;
      } else if (rawStatus.includes("보류")) {
        statusText = "보류";
        statusColor = COLOR_NEUTRAL;
      }

      const prevRecipientData = prevSheetMap.get(name);
      const prevYearRecipientData = prevYearSheetMap.get(name);

      // 개별 수급자 연산 데이터 객체
      const recipientResult = {
        no: rawNo,
        status: { text: statusText, color: statusColor },
        name: name,
        contractDate: { text: "", link: "", color: COLOR_WHITE }, // D열: 표준약관 작성일자
        planEndDate: { text: "", color: COLOR_WHITE }, // E열: 급여제공계획서 종료일자
        fallUpper: { text: "", color: COLOR_WHITE }, // F열: 낙상 (상반기)
        bedsoresUpper: { text: "", color: COLOR_WHITE }, // G열: 욕창 (상반기)
        cognitionUpper: { text: "", color: COLOR_WHITE }, // H열: 인지 (상반기)
        fallLower: { text: "", color: COLOR_WHITE }, // I열: 낙상 (하반기)
        bedsoresLower: { text: "", color: COLOR_WHITE }, // J열: 욕창 (하반기)
        cognitionLower: { text: "", color: COLOR_WHITE }, // K열: 인지 (하반기)
        desireEval: { text: "", color: COLOR_WHITE }, // L열: 욕구사정
        planWriteDate: { text: "", link: "", color: COLOR_WHITE }, // M열: 급여제공계획서 작성일자
        planType: { text: "", color: COLOR_WHITE }, // N열: 급여제공계획서 종류
        resultEvalDate: { text: "", link: "", color: COLOR_WHITE }, // O열: 결과평가 작성일자
        planStartDate: { text: "", color: COLOR_WHITE }, // P열: 적용기간(시작)
        planEndDateRef: { text: "", color: COLOR_WHITE }, // Q열: 적용기간(종료)
        contractStartDate: { text: "", note: "", link: "", color: COLOR_WHITE }, // R열: 급여계약기간(시작)
        contractEndDate: { text: "", note: "", link: "", color: COLOR_WHITE }, // S열: 급여계약기간(종료)
        remark: { text: "", note: "", color: COLOR_WHITE }, // T열: 비고
      };

      try {
        // ----------------------------------------------------------------------
        // 4-1. 급여제공계획 적용기간 시작/종료 (현재 시트 P, Q열 / 케어포연동 시트 L열 원천 데이터 파싱)
        // ----------------------------------------------------------------------
        const rawRowStr = row.join(" ");
        const dateRangeMatch = rawRowStr.match(
          /(\d{2}\.\d{2}\.\d{2})\s*~\s*(\d{2}\.\d{2}\.\d{2})/,
        );

        if (dateRangeMatch) {
          recipientResult.planStartDate = {
            text: formatYYMMDD(dateRangeMatch[1]),
            color: COLOR_POSITIVE,
          };
          recipientResult.planEndDateRef = {
            text: formatYYMMDD(dateRangeMatch[2]),
            color: COLOR_POSITIVE,
          };
        } else if (prevYearRecipientData?.planStartDate?.text) {
          recipientResult.planStartDate = prevYearRecipientData.planStartDate;
          recipientResult.planEndDateRef = prevYearRecipientData.planEndDateRef;
        } else if (prevRecipientData?.planStartDate?.text) {
          recipientResult.planStartDate = prevRecipientData.planStartDate;
          recipientResult.planEndDateRef = prevRecipientData.planEndDateRef;
        } else {
          recipientResult.planStartDate = {
            text: "오류",
            color: COLOR_NEGATIVE,
          };
          recipientResult.planEndDateRef = {
            text: "오류",
            color: COLOR_NEGATIVE,
          };
          addLog(
            logs,
            name,
            rowIndex,
            "급여제공계획 적용기간",
            "필수 데이터 누락",
            "적용기간 시작/종료일을 찾을 수 없습니다.",
          );
        }

        // ----------------------------------------------------------------------
        // 4-2. 급여제공계획서 종료일자 (현재 시트 E열)
        // ----------------------------------------------------------------------
        if (prevRecipientData?.planEndDate?.text) {
          recipientResult.planEndDate = prevRecipientData.planEndDate;
        } else if (prevYearRecipientData?.planEndDateRef?.text) {
          recipientResult.planEndDate = prevYearRecipientData.planEndDateRef;
        } else if (
          recipientResult.planEndDateRef.text &&
          recipientResult.planEndDateRef.text !== "오류"
        ) {
          recipientResult.planEndDate = recipientResult.planEndDateRef;
        } else {
          recipientResult.planEndDate = {
            text: "알 수 없음\n(직접입력필요)",
            color: COLOR_NEGATIVE,
          };
        }

        // ----------------------------------------------------------------------
        // [도메인 용어] 종료일 한 달 전 정의 및 계산
        // 종료일 한 달 전: 기준일(종료일)이 속한 월의 "전월 1일부터 말일까지"를 의미한다.
        // ----------------------------------------------------------------------
        const planEndDateStr = recipientResult.planEndDate.text;
        const isDueMonth = isCurrentInOneMonthBefore(planEndDateStr);

        // ----------------------------------------------------------------------
        // 4-3. 표준약관 작성일자 (현재 시트 D열)
        // [도메인 용어] 인정서 갱신: 인정유효기간 종료일 이후 새로운 인정유효기간 종료일을 가지는 표준약관을 작성하는 것
        // [도메인 용어] 변경 계약서: 인정유효기간 종료일(만료일) 이전에 추가 작성된 표준약관 (인정유효기간 변경 없음)
        // ----------------------------------------------------------------------
        const prevYearContractEnd =
          prevYearRecipientData?.contractEndDate?.text ?? "";
        const currentYearStr = now.getFullYear().toString();

        if (
          prevYearContractEnd &&
          !prevYearContractEnd.startsWith(currentYearStr)
        ) {
          recipientResult.contractDate = {
            text: "",
            color: COLOR_WHITE,
            link: "",
          };
        } else {
          if (isDueMonth || isCurrentAfterOneMonthBefore(planEndDateStr)) {
            // 캐싱된 드라이브 Map에서 [수급자명_표준약관_인정유효기간갱신] 최신 파일 조회
            const fileKey = `${name}_표준약관`;
            const driveFile =
              driveFileMap.get(fileKey) ||
              driveFileMap.get(`${name}_표준약관_급여계약기간갱신(인증서)`);

            if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
              recipientResult.contractDate = {
                text: driveFile.fileDate,
                color: COLOR_POSITIVE,
                link: driveFile.fileUrl,
              };
            } else {
              recipientResult.contractDate = {
                text: "갱신필요",
                color: COLOR_NEGATIVE,
                link: "",
              };
              addLog(
                logs,
                name,
                rowIndex,
                "표준약관 작성일자",
                "미작성 및 갱신 필요 건",
                "올해 기준 표준약관 파일 날짜 불일치 또는 미작성",
              );
            }
          } else {
            recipientResult.contractDate = {
              text: "갱신필요",
              color: COLOR_NEGATIVE,
              link: "",
            };
          }
        }

        // ----------------------------------------------------------------------
        // 4-4. 기초평가(낙상, 욕창, 인지) & 욕구사정 (현재 시트 F~L열 / 케어포연동 시트 원천 데이터 파싱)
        // [도메인 용어] 기초평가 작성 주기: 반기별 1회 작성. 2회 중 1회는 반드시 '급여제공계획서 종료일자 한 달 전'에 작성되어야 함.
        // ----------------------------------------------------------------------
        const processEvalCell = (colIdx) => {
          const val = row[colIdx]?.toString().trim() ?? "";
          const parsedVal = parseDateString(val);

          if (parsedVal) {
            return { text: parsedVal, color: COLOR_POSITIVE };
          } else {
            if (val === "미작성" || !val) {
              return {
                text: "미작성",
                color: isDueMonth ? COLOR_NEGATIVE : COLOR_NEUTRAL,
              };
            }
            return {
              text: val,
              color: isDueMonth ? COLOR_NEGATIVE : COLOR_NEUTRAL,
            };
          }
        };

        recipientResult.fallUpper = processEvalCell(4); // 케어포연동 E열 (낙상 상반기)
        recipientResult.fallLower = processEvalCell(5); // 케어포연동 F열 (낙상 하반기)
        recipientResult.bedsoresUpper = processEvalCell(6); // 케어포연동 G열 (욕창 상반기)
        recipientResult.bedsoresLower = processEvalCell(7); // 케어포연동 H열 (욕창 하반기)
        recipientResult.cognitionUpper = processEvalCell(8); // 케어포연동 I열 (인지 상반기)
        recipientResult.cognitionLower = processEvalCell(9); // 케어포연동 J열 (인지 하반기)
        recipientResult.desireEval = processEvalCell(10); // 케어포연동 K열 (욕구사정)

        // ----------------------------------------------------------------------
        // 4-5. 급여제공계획서 작성일자 & 종류 (현재 시트 M, N열 / 케어포연동 시트 L열 원천 데이터 파싱)
        // ----------------------------------------------------------------------
        const rawPlanText = row[11]?.toString().trim() ?? "";
        const matchPublic = rawPlanText.match(
          /(\d{2,4}[.-]\d{1,2}[.-]\d{1,2})/,
        );

        if (rawPlanText.includes("미작성") || !rawPlanText) {
          recipientResult.planWriteDate = {
            text: "미작성",
            color: isDueMonth ? COLOR_NEGATIVE : COLOR_NEUTRAL,
            link: "",
          };
        } else if (rawPlanText.includes("계약해지")) {
          recipientResult.planWriteDate = {
            text: "계약해지",
            color: COLOR_NEUTRAL,
            link: "",
          };
        } else if (matchPublic) {
          const formattedDate = parseDateString(matchPublic[1]);
          const driveFile = driveFileMap.get(`${name}_급여제공계획서`);

          if (
            driveFile &&
            (driveFile.fileDate === formattedDate ||
              formattedDate.includes(driveFile.fileDate))
          ) {
            recipientResult.planWriteDate = {
              text: formattedDate,
              color: COLOR_POSITIVE,
              link: driveFile.fileUrl,
            };
          } else {
            recipientResult.planWriteDate = {
              text: `${formattedDate}\n(파일오류)`,
              color: COLOR_NEGATIVE,
              link: "",
            };
            addLog(
              logs,
              name,
              rowIndex,
              "급여제공계획서 작성일자",
              "파일 미매칭 / 날짜 형식 오류",
              "드라이브 계획서 파일 날짜와 원천 데이터 불일치",
            );
          }
        } else {
          recipientResult.planWriteDate = {
            text: rawPlanText,
            color: COLOR_POSITIVE,
            link: "",
          };
        }

        // 종류: 문맥에 따라 "방문요양" 또는 "방문목욕" 표기
        const planTypeStr = rawPlanText.includes("목욕")
          ? "방문목욕"
          : "방문요양";
        recipientResult.planType = {
          text: planTypeStr,
          color: recipientResult.planWriteDate.color,
        };

        // ----------------------------------------------------------------------
        // 4-6. 결과평가 작성일자 (현재 시트 O열)
        // [도메인 용어] 결과평가 작성일자: 연 1회, 급여제공계획서 종료일자 한 달 전에 작성되어야 한다.
        // ----------------------------------------------------------------------
        if (!isDueMonth) {
          // 작성 의무 기간이 아니면 직전 시트에서 이관된 상태 그대로 유지
          if (prevRecipientData?.resultEvalDate) {
            recipientResult.resultEvalDate = prevRecipientData.resultEvalDate;
          } else {
            recipientResult.resultEvalDate = {
              text: "",
              color: COLOR_WHITE,
              link: "",
            };
          }
        } else {
          // 작성 의무 기간일 경우 드라이브 파일 조회
          const driveFile =
            driveFileMap.get(`${name}_급여제공결과평가`) ||
            driveFileMap.get(`${name}_급여제공결과평가(모니터링)`);

          if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
            recipientResult.resultEvalDate = {
              text: driveFile.fileDate,
              color: COLOR_POSITIVE,
              link: driveFile.fileUrl,
            };
          } else {
            const prevText = prevRecipientData?.resultEvalDate?.text ?? "";
            if (prevText) {
              recipientResult.resultEvalDate = {
                text: `${prevText}\n(파일오류)`,
                color: COLOR_NEGATIVE,
                link: "",
              };
            } else {
              recipientResult.resultEvalDate = {
                text: "미작성",
                color: COLOR_NEGATIVE,
                link: "",
              };
            }
            addLog(
              logs,
              name,
              rowIndex,
              "결과평가 작성일자",
              "미작성 및 갱신 필요 건",
              "작성 의무 기간 내 결과평가 파일이 없거나 올해 파일이 아닙니다.",
            );
          }
        }

        // ----------------------------------------------------------------------
        // 4-7. 수동 기입 및 직전 시트 승계 항목 - 인정유효기간(시작/종료 - 현재 시트 R, S열) 및 비고(현재 시트 T열)
        // 완벽 승계 원칙: 직전 시트 데이터 존재 시 RichText, 배경색, 글자색, 메모 통째로 복원 이관
        // ----------------------------------------------------------------------
        if (prevRecipientData?.contractStartDate?.text) {
          recipientResult.contractStartDate =
            prevRecipientData.contractStartDate;
          recipientResult.contractEndDate = prevRecipientData.contractEndDate;
          recipientResult.remark = prevRecipientData.remark;
        } else {
          if (!recipientResult.contractDate.text) {
            recipientResult.contractStartDate =
              prevYearRecipientData?.contractStartDate ?? {
                text: "",
                color: COLOR_WHITE,
              };
            recipientResult.contractEndDate =
              prevYearRecipientData?.contractEndDate ?? {
                text: "",
                color: COLOR_WHITE,
              };
          } else if (
            recipientResult.contractDate.text.match(/\d{4}-\d{2}-\d{2}/)
          ) {
            recipientResult.contractStartDate = {
              text: "미작성",
              color: COLOR_NEGATIVE,
            };
            recipientResult.contractEndDate = {
              text: "미작성",
              color: COLOR_NEGATIVE,
            };
          } else {
            recipientResult.contractStartDate = {
              text: "알 수 없음\n(직접입력필요)",
              color: COLOR_NEGATIVE,
            };
            recipientResult.contractEndDate = {
              text: "알 수 없음\n(직접입력필요)",
              color: COLOR_NEGATIVE,
            };
            addLog(
              logs,
              name,
              rowIndex,
              "인정유효기간",
              "필수 데이터 누락",
              "인정유효기간 정보가 없습니다.",
            );
          }
          recipientResult.remark = prevRecipientData?.remark ?? {
            text: "",
            color: COLOR_WHITE,
          };
        }
      } catch (rowErr) {
        addLog(
          logs,
          name,
          rowIndex,
          "행 전체 연산",
          "런타임 오류",
          rowErr.message,
        );
      }

      processedRows.push(recipientResult);
    });

    // --------------------------------------------------------------------------
    // Step 5: 새 시트 생성, 데이터 일괄 작성, 서식 적용 및 로그 일괄 저장 (Batch Operation)
    // --------------------------------------------------------------------------
    // [Step 5] API 타임아웃 방지를 위한 Batch 처리 (setValues, setBackgrounds, setRichTextValues, setNotes)
    const newSheetName = nowStr;
    const newSheet = targetSs.insertSheet(newSheetName, 0);

    // 상단 1~3행 컨트롤 바 및 5행 헤더 레이아웃 생성
    setupHeaderAndControls(newSheet, prevC2Url, prevC3Url);

    if (processedRows.length > 0) {
      const rowCount = processedRows.length;
      const values = [];
      const backgrounds = [];
      const fontColors = [];
      const richTextValues = [];
      const notes = [];

      processedRows.forEach((r) => {
        values.push([
          r.no,
          r.status.text,
          r.name,
          r.contractDate.text,
          r.planEndDate.text,
          r.fallUpper.text,
          r.bedsoresUpper.text,
          r.cognitionUpper.text,
          r.fallLower.text,
          r.bedsoresLower.text,
          r.cognitionLower.text,
          r.desireEval.text,
          r.planWriteDate.text,
          r.planType.text,
          r.resultEvalDate.text,
          r.planStartDate.text,
          r.planEndDateRef.text,
          r.contractStartDate.text,
          r.contractEndDate.text,
          r.remark.text,
        ]);

        backgrounds.push([
          COLOR_WHITE,
          r.status.color,
          COLOR_WHITE,
          r.contractDate.color,
          r.planEndDate.color,
          r.fallUpper.color,
          r.bedsoresUpper.color,
          r.cognitionUpper.color,
          r.fallLower.color,
          r.bedsoresLower.color,
          r.cognitionLower.color,
          r.desireEval.color,
          r.planWriteDate.color,
          r.planType.color,
          r.resultEvalDate.color,
          r.planStartDate.color,
          r.planEndDateRef.color,
          r.contractStartDate.color,
          r.contractEndDate.color,
          r.remark.color,
        ]);

        fontColors.push(Array(20).fill("#000000"));

        richTextValues.push([
          buildRichText(r.no),
          buildRichText(r.status.text),
          buildRichText(r.name),
          buildRichText(r.contractDate.text, r.contractDate.link),
          buildRichText(r.planEndDate.text),
          buildRichText(r.fallUpper.text),
          buildRichText(r.bedsoresUpper.text),
          buildRichText(r.cognitionUpper.text),
          buildRichText(r.fallLower.text),
          buildRichText(r.bedsoresLower.text),
          buildRichText(r.cognitionLower.text),
          buildRichText(r.desireEval.text),
          buildRichText(r.planWriteDate.text, r.planWriteDate.link),
          buildRichText(r.planType.text),
          buildRichText(r.resultEvalDate.text, r.resultEvalDate.link),
          buildRichText(r.planStartDate.text),
          buildRichText(r.planEndDateRef.text),
          buildRichText(r.contractStartDate.text, r.contractStartDate.link),
          buildRichText(r.contractEndDate.text, r.contractEndDate.link),
          buildRichText(r.remark.text),
        ]);

        notes.push([
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          r.contractStartDate.note || "",
          r.contractEndDate.note || "",
          r.remark.note || "",
        ]);
      });

      const dataRange = newSheet.getRange(6, 1, rowCount, 20);
      dataRange.setValues(values);
      dataRange.setBackgrounds(backgrounds);
      dataRange.setFontColors(fontColors);
      dataRange.setRichTextValues(richTextValues);
      dataRange.setNotes(notes);
    }

    // 직전 시트에 설정되어 있던 조건부 서식 규칙 재적용
    if (prevSheet) {
      try {
        const condRules = prevSheet.getConditionalFormatRules();
        if (condRules && condRules.length > 0) {
          newSheet.setConditionalFormatRules(condRules);
        }
      } catch (e) {
        console.error("조건부 서식 복사 실패: " + e.message);
      }
    }

    // Log 시트에 일괄 기록
    if (logs.length > 0) {
      logSheet
        .getRange(logSheet.getLastRow() + 1, 1, logs.length, 6)
        .setValues(logs);
    }

    // --------------------------------------------------------------------------
    // Step 6: 시트 순서 정렬, 이름 재설정 및 과거 시트 자동 정리
    // --------------------------------------------------------------------------
    // [Step 6] 시트 순서 및 이름 재설정 규칙 적용
    reorderAndCleanSheets(targetSs, newSheetName);

    // 완료 알림 얼러트 출력
    ui.alert(
      "완료",
      "모든 데이터 연동 및 정리가 완료되었습니다.",
      ui.ButtonSet.OK,
    );
  } catch (globalErr) {
    addLog(
      logs,
      "GLOBAL",
      0,
      "파이프라인",
      4, // 런타임 오류 구분
      globalErr.stack || globalErr.message,
    );
    const logSheet = targetSs.getSheetByName(SHEET_NAME_LOG);
    if (logSheet && logs.length > 0) {
      logSheet
        .getRange(logSheet.getLastRow() + 1, 1, logs.length, 6)
        .setValues(logs);
    }
    ui.alert(
      "오류 발생",
      "파이프라인 실행 중 오류가 발생했습니다. Log 시트를 확인해주세요.",
      ui.ButtonSet.OK,
    );
  }
}

// ==============================================================================
// 서브 헬퍼 함수 및 유틸리티
// ==============================================================================

/**
 * 상단 컨트롤 바(1~3행) 및 헤더(5행) 세팅 헬퍼
 */
function setupHeaderAndControls(sheet, c2Val, c3Val) {
  sheet.getRange("A1").setValue("케어포");
  sheet.getRange("B1").setValue("연동일시");
  sheet.getRange("C1").setValue("업데이트");

  // C1 셀 드롭다운 유효성 검사 설정 유지
  const rule = SpreadsheetApp.newDataValidation()
    .explicitValueListInCell(["업데이트"])
    .build();
  sheet.getRange("C1").setDataValidation(rule).setValue("업데이트");

  sheet.getRange("A2").setValue("전년도");
  sheet.getRange("B2").setValue("시트");
  sheet.getRange("C2").setValue(c2Val);

  sheet.getRange("A3").setValue("수급자");
  sheet.getRange("B3").setValue("기본자료");
  sheet.getRange("C3").setValue(c3Val);

  // 1~3행 스타일링 (A, B열 스타일 규칙)
  sheet
    .getRange("A1:B3")
    .setBackground("#1155cc")
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");
  sheet.getRange("A1:A3").setHorizontalAlignment("right");
  sheet.getRange("B1:B3").setHorizontalAlignment("left");

  const headers = [
    "No.",
    "현황",
    "수급자명",
    "표준약관\n작성일자",
    "급여제공계획서\n종료일자",
    "낙상위험도\n(상반기)",
    "욕창위험도\n(상반기)",
    "인지기능\n(상반기)",
    "낙상위험도\n(하반기)",
    "욕창위험도\n(하반기)",
    "인지기능\n(하반기)",
    "욕구사정",
    "급여제공계획서\n작성일자",
    "급여제공계획서\n종류",
    "결과평가\n작성일자",
    "급여제공계획\n적용기간(시작)",
    "급여제공계획\n적용기간(종료)",
    "급여계약기간(시작)",
    "급여계약기간(종료)",
    "비고",
  ];

  const headerRange = sheet.getRange(5, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setBackground(COLOR_TITLE)
    .setFontColor(COLOR_WHITE)
    .setFontWeight("bold");
  headerRange.setHorizontalAlignment("center").setVerticalAlignment("middle");

  sheet
    .getDataRange()
    .setFontSize(12)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(3);
}

/**
 * C1 셀 드롭다운 유효성 및 값 초기화 유지 헬퍼
 */
function resetC1Dropdown(sheet) {
  const rule = SpreadsheetApp.newDataValidation()
    .explicitValueListInCell(["업데이트"])
    .build();
  sheet.getRange("C1").setDataValidation(rule).setValue("업데이트");
}

/**
 * 로그 기록용 헬퍼 함수
 */
function addLog(logsArray, recipientName, rowNum, colName, issueType, detail) {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss",
  );
  logsArray.push([
    timestamp,
    recipientName,
    rowNum,
    colName,
    issueType,
    detail,
  ]);
}

/**
 * 구글 드라이브 URL에서 Folder ID 추출
 */
function extractDriveIdFromUrl(url) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * 드라이브 하위 폴더/파일 재귀적 스캔 및 Caching (API 최적화)
 */
function cacheDriveFilesRecursive(folder, map) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);

    if (dateMatch) {
      const parentName = folder.getName().replace(/\s+/g, "").trim();
      const key = `${parentName}_${fileName.split("_")[1] || fileName}`;

      const existing = map.get(key);
      const fileDate = dateMatch[1];

      if (!existing || existing.fileDate < fileDate) {
        map.set(key, {
          fileName: fileName,
          fileUrl: file.getUrl(),
          fileDate: fileDate,
        });
      }
      // 일반 파일명 매칭 키도 함께 저장
      map.set(fileName, {
        fileName: fileName,
        fileUrl: file.getUrl(),
        fileDate: fileDate,
      });
    }
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    cacheDriveFilesRecursive(subFolders.next(), map);
  }
}

/**
 * 시트 전체 메타데이터 메모리 래핑 (Value, Background, RichText, Note)
 */
function cacheSheetMetadata(sheet) {
  const map = new Map();
  if (!sheet) return map;

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return map;

  const range = sheet.getRange(6, 1, lastRow - 5, 20);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const richTexts = range.getRichTextValues();
  const notes = range.getNotes();

  values.forEach((r, i) => {
    const name = r[2]
      ?.toString()
      .replace(/\(.*?\)/g, "")
      .replace(/[\r\n]+/g, "")
      .replace(/\s+/g, "")
      .trim();
    if (name) {
      map.set(name, {
        contractDate: {
          text: r[3],
          color: backgrounds[i][3],
          link: richTexts[i][3]?.getLinkUrl(),
        },
        planEndDate: { text: r[4], color: backgrounds[i][4] },
        resultEvalDate: {
          text: r[14],
          color: backgrounds[i][14],
          link: richTexts[i][14]?.getLinkUrl(),
        },
        planStartDate: { text: r[15], color: backgrounds[i][15] },
        planEndDateRef: { text: r[16], color: backgrounds[i][16] },
        contractStartDate: {
          text: r[17],
          color: backgrounds[i][17],
          note: notes[i][17],
          link: richTexts[i][17]?.getLinkUrl(),
        },
        contractEndDate: {
          text: r[18],
          color: backgrounds[i][18],
          note: notes[i][18],
          link: richTexts[i][18]?.getLinkUrl(),
        },
        remark: { text: r[19], color: backgrounds[i][19], note: notes[i][19] },
      });
    }
  });

  return map;
}

/**
 * RichTextValue 생성 헬퍼 함수
 */
function buildRichText(text, linkUrl) {
  const builder = SpreadsheetApp.newRichTextValue().setText(text || "");
  if (linkUrl) {
    builder.setLinkUrl(linkUrl);
  }
  return builder.build();
}

/**
 * 날짜 문자열 파싱 헬퍼 (YYYY.MM.dd 등 -> YYYY-MM-dd 변환)
 */
function parseDateString(str) {
  if (!str) return null;
  const match = String(str).match(/(\d{2,4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (match) {
    let year = match[1];
    if (year.length === 2) year = "20" + year;
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * YY.MM.DD -> YYYY-MM-DD 포맷 변환
 */
function formatYYMMDD(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split(".");
  if (parts.length === 3) {
    const year = parts[0].length === 2 ? `20${parts[0]}` : parts[0];
    const month = parts[1].padStart(2, "0");
    const day = parts[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

/**
 * [도메인 규칙] 종료일 한 달 전 여부 판단
 * 종료일 한 달 전 = 종료일 속한 월의 "전월 1일부터 말일까지"
 */
function isCurrentInOneMonthBefore(endDateStr) {
  if (!endDateStr || !endDateStr.match(/\d{4}-\d{2}-\d{2}/)) return false;
  try {
    const endParts = endDateStr.split("-");
    const endYear = parseInt(endParts[0], 10);
    const endMonth = parseInt(endParts[1], 10);

    // 전월 계산
    let targetYear = endYear;
    let targetMonth = endMonth - 1;
    if (targetMonth === 0) {
      targetYear -= 1;
      targetMonth = 12;
    }

    const now = new Date();
    return (
      now.getFullYear() === targetYear && now.getMonth() + 1 === targetMonth
    );
  } catch (e) {
    return false;
  }
}

function isCurrentAfterOneMonthBefore(endDateStr) {
  if (!endDateStr || !endDateStr.match(/\d{4}-\d{2}-\d{2}/)) return false;
  try {
    const endParts = endDateStr.split("-");
    const endYear = parseInt(endParts[0], 10);
    const endMonth = parseInt(endParts[1], 10);

    let targetYear = endYear;
    let targetMonth = endMonth - 1;
    if (targetMonth === 0) {
      targetYear -= 1;
      targetMonth = 12;
    }

    const now = new Date();
    const nowDateVal = now.getFullYear() * 12 + (now.getMonth() + 1);
    const targetDateVal = targetYear * 12 + targetMonth;

    return nowDateVal > targetDateVal;
  } catch (e) {
    return false;
  }
}

/**
 * 시트 순서 정렬, 이름 재설정 및 과거 시트 자동 정리 헬퍼
 */
function reorderAndCleanSheets(ss, currentSheetName) {
  const sheets = ss.getSheets();
  const currentSheet = ss.getSheetByName(currentSheetName);
  let careSync = ss.getSheetByName(SHEET_NAME_CAREFOR);
  let logSheet = ss.getSheetByName(SHEET_NAME_LOG);

  const prevSheetTarget = sheets.find(
    (s) =>
      s.getName() !== currentSheetName &&
      !s.getName().includes(SHEET_NAME_CAREFOR) &&
      !s.getName().includes(SHEET_NAME_LOG),
  );

  sheets.forEach((s) => {
    let name = s.getName();
    if (name.includes("(직전시트)")) {
      const cleanName = name.replace("(직전시트)", "");
      try {
        s.setName(cleanName);
      } catch (e) {}
    }
  });

  if (prevSheetTarget) {
    try {
      const oldName = prevSheetTarget.getName().replace("(직전시트)", "");
      prevSheetTarget.setName(`(직전시트)${oldName}`);
    } catch (e) {}
  }

  // 위치 재배치 (1: 현재, 2: 케어포연동, 3: 직전시트, 4: Log)
  if (currentSheet) {
    ss.setActiveSheet(currentSheet);
    ss.moveActiveSheet(1);
  }
  if (careSync) {
    ss.setActiveSheet(careSync);
    ss.moveActiveSheet(2);
  }
  if (prevSheetTarget) {
    ss.setActiveSheet(prevSheetTarget);
    ss.moveActiveSheet(3);
  }
  if (logSheet) {
    ss.setActiveSheet(logSheet);
    ss.moveActiveSheet(4);
  }

  // 기타 과거 시트 순서 정렬 및 2개 초과분 자동 삭제
  const allSheetsAfter = ss.getSheets();
  const pastSheets = allSheetsAfter.filter((s) => {
    const name = s.getName();
    return (
      name !== currentSheetName &&
      name !== SHEET_NAME_CAREFOR &&
      name !== SHEET_NAME_LOG &&
      !name.includes("(직전시트)")
    );
  });

  pastSheets.sort((a, b) => b.getName().localeCompare(a.getName()));

  if (pastSheets.length > 2) {
    pastSheets.slice(2).forEach((s) => {
      try {
        ss.deleteSheet(s);
      } catch (e) {}
    });
  }
}

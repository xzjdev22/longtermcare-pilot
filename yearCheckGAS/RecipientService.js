/**
 * 케어포 원본 행 데이터를 가공하여 수급자별 각종 서류 작성일자, 평가 주기 및 상태를 연산합니다.
 */
function processRecipientRow(
  row, // 케어포에서 추출한 단건 수급자 원본 데이터 행 배열
  idx, // 현재 행의 순번 인덱스
  driveFileMap, // 구글 드라이브 파일 메타데이터 맵
  prevRecipientData, // 직전 월 시트의 수급자별 데이터 맵
  prevYearRecipientData, // 전년도 시트의 수급자별 데이터 맵
  currentYearStr, // 현재 기준 연도 문자열 (예: "2026")
  now, // 현재 시스템 시각 객체
) {
  const rawNo = row[0]; // Col A: No. 원본 값
  // No. 값이 존재하지 않거나 숫자가 아닐 경우 유효하지 않은 행으로 판단하여 즉시 반환하는 분기
  if (!rawNo || isNaN(parseInt(rawNo, 10))) {
    return { isValid: false };
  }

  const rowIndex = 11 + idx;
  const rawStatus = row[1]?.toString().trim() ?? ""; // Col B: 현황 원본 값
  const rawName = row[2]?.toString().trim() ?? ""; // Col C: 수급자명 원본 값

  // 수급자명 내부의 괄호, 줄바꿈, 공백 등을 제거하여 정규화된 이름 생성
  const name = rawName
    .replace(/\(.*?\)/g, "")
    .replace(/[\r\n]+/g, "")
    .replace(/\s+/g, "")
    .trim();

  // 수급자명이 비어있는 경우 필수 데이터 누락 에러 객체를 반환하는 분기
  if (!name) {
    return {
      isValid: false,
      error: {
        name: "미상",
        rowNum: rowIndex,
        colName: "수급자명",
        type: "필수 데이터 누락",
        detail: "수급자명이 결손되어 해당 행을 스킵합니다.",
      },
    };
  }

  let statusText = "불명";
  let statusColor = COLOR_NEGATIVE;

  // 수급자 현황 문자열 내용에 따라 상태 텍스트와 UI 배경 색상을 분기 처리
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

  const recipientResult = {
    isValid: true,
    no: rawNo,
    status: { text: statusText, color: statusColor },
    name: name,
    contractDate: { text: "", link: "", color: COLOR_WHITE }, // Col D: 표준약관 작성일자
    planEndDate: { text: "", color: COLOR_WHITE }, // Col E: 급여제공계획서 종료일자
    fallUpper: { text: "", color: COLOR_WHITE }, // Col F: 낙상위험도(상반기)
    bedsoresUpper: { text: "", color: COLOR_WHITE }, // Col G: 욕창위험도(상반기)
    cognitionUpper: { text: "", color: COLOR_WHITE }, // Col H: 인지기능(상반기)
    fallLower: { text: "", color: COLOR_WHITE }, // Col I: 낙상위험도(하반기)
    bedsoresLower: { text: "", color: COLOR_WHITE }, // Col J: 욕창위험도(하반기)
    cognitionLower: { text: "", color: COLOR_WHITE }, // Col K: 인지기능(하반기)
    desireEval: { text: "", color: COLOR_WHITE }, // Col L: 욕구사정
    planWriteDate: { text: "", link: "", color: COLOR_WHITE }, // Col M: 급여제공계획서 작성일자
    planType: { text: "", color: COLOR_WHITE }, // Col N: 급여제공계획서 종류
    resultEvalDate: { text: "", link: "", color: COLOR_WHITE }, // Col O: 결과평가 작성일자
    planStartDate: { text: "", color: COLOR_WHITE }, // Col P: 급여제공계획 적용기간(시작)
    planEndDateRef: { text: "", color: COLOR_WHITE }, // Col Q: 급여제공계획 적용기간(종료)
    contractStartDate: { text: "", note: "", link: "", color: COLOR_WHITE }, // Col R: 인정유효기간(시작)
    contractEndDate: { text: "", note: "", link: "", color: COLOR_WHITE }, // Col S: 인정유효기간(종료)
    remark: { text: "", note: "", color: COLOR_WHITE }, // Col T: 비고
  };

  try {
    const rawRowStr = row.join(" ");
    const dateRangeMatch = rawRowStr.match(
      /(\d{2}\.\d{2}\.\d{2})\s*~\s*(\d{2}\.\d{2}\.\d{2})/,
    );

    // 행 데이터 내에 날짜 범위 패턴(YY.MM.DD ~ YY.MM.DD)이 존재하는지 확인하는 분기
    if (dateRangeMatch) {
      recipientResult.planStartDate = {
        text: parseDateString(dateRangeMatch[1]) || dateRangeMatch[1],
        color: COLOR_POSITIVE,
      };
      recipientResult.planEndDateRef = {
        text: parseDateString(dateRangeMatch[2]) || dateRangeMatch[2],
        color: COLOR_POSITIVE,
      };
    } else if (prevYearRecipientData?.planStartDate?.text) {
      // 당해 연도 날짜 패턴이 없고 전년도 시트에 계획 시작일 데이터가 존재하는 경우 대체 적용하는 분기
      recipientResult.planStartDate = {
        text: prevYearRecipientData.planStartDate.text,
        color: COLOR_WHITE,
      };
      recipientResult.planEndDateRef = {
        text: prevYearRecipientData.planEndDateRef.text,
        color: COLOR_WHITE,
      };
    } else if (prevRecipientData?.planStartDate?.text) {
      // 전년도에도 없고 직전 월 시트에 계획 시작일 데이터가 존재하는 경우 대체 적용하는 분기
      recipientResult.planStartDate = {
        text: prevRecipientData.planStartDate.text,
        color: COLOR_WHITE,
      };
      recipientResult.planEndDateRef = {
        text: prevRecipientData.planEndDateRef.text,
        color: COLOR_WHITE,
      };
    } else {
      // 모든 곳에 유효한 계획 기간 데이터가 없을 경우 에러 상태로 처리하는 분기
      recipientResult.planStartDate = { text: "오류", color: COLOR_NEGATIVE };
      recipientResult.planEndDateRef = { text: "오류", color: COLOR_NEGATIVE };
    }

    // 급여제공계획서 종료일자 결정을 위한 우선순위별 조건 분기
    if (prevRecipientData?.planEndDate?.text) {
      // 직전 월 시트에 종료일 데이터가 존재하는 경우 가져옴
      recipientResult.planEndDate = {
        text: prevRecipientData.planEndDate.text,
        color: COLOR_WHITE,
      };
    } else if (prevYearRecipientData?.planEndDateRef?.text) {
      // 직전 월에 없고 전년도 시트의 참조 종료일이 존재하는 경우 가져옴
      recipientResult.planEndDate = {
        text: prevYearRecipientData.planEndDateRef.text,
        color: COLOR_WHITE,
      };
    } else if (
      recipientResult.planEndDateRef.text &&
      recipientResult.planEndDateRef.text !== "오류"
    ) {
      // 현재 연산된 참조 종료일 값이 유효한 경우 가져옴
      recipientResult.planEndDate = {
        text: recipientResult.planEndDateRef.text,
        color: COLOR_WHITE,
      };
    } else {
      // 모든 조건을 만족하지 못해 종료일을 알 수 없는 경우 부정 상태 처리
      recipientResult.planEndDate = {
        text: "알 수 없음",
        color: COLOR_NEGATIVE,
      };
    }

    const planEndDateStr = recipientResult.planEndDate.text;
    const isAfterPrevMonthFirstDay =
      hasPreviousMonthFirstDayPassed(planEndDateStr);

    let prevYearContractEnd =
      prevYearRecipientData?.contractEndDate?.text ?? "";

    // 전년도 계약 종료일 데이터 타입에 따른 날짜 포맷 변환 분기
    if (prevYearContractEnd instanceof Date) {
      prevYearContractEnd = Utilities.formatDate(
        prevYearContractEnd,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd",
      );
    } else {
      prevYearContractEnd =
        parseDateString(prevYearContractEnd) ||
        String(prevYearContractEnd).trim();
    }

    // 전년도 계약 종료일이 존재하고 당해 연도 문자열로 시작하지 않는 경우의 처리 분기
    if (
      prevYearContractEnd &&
      !prevYearContractEnd.startsWith(currentYearStr)
    ) {
      recipientResult.contractDate = { text: "", color: COLOR_WHITE, link: "" };
    } else {
      // 전월 첫째 날이 경과했는지 여부에 따른 표준약관 작성일자 갱신 로직 분기
      if (isAfterPrevMonthFirstDay) {
        const fileKey = `${name}_표준약관`;
        const driveFile =
          driveFileMap.get(fileKey) ||
          driveFileMap.get(`${name}_표준약관_인정유효기간갱신`);

        // 드라이브 파일이 존재하고 파일 작성일자가 당해 연도에 속하는지 확인하는 분기
        if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
          recipientResult.contractDate = {
            text: parseDateString(driveFile.fileDate) || driveFile.fileDate,
            color: COLOR_POSITIVE,
            link: driveFile.fileUrl,
          };
        } else {
          recipientResult.contractDate = {
            text: "갱신필요",
            color: COLOR_NEGATIVE,
            link: "",
          };
        }
      } else {
        recipientResult.contractDate = {
          text: "갱신필요",
          color: COLOR_WHITE,
          link: "",
        };
      }
    }

    /**
     * 위험도 및 욕구사정 평가 항목 셀 데이터를 파싱하고 평가 주기 도래 여부에 따라 색상을 결정합니다.
     */
    const processEvalCell = (
      colIdx, // 원본 행 내 대상 열 인덱스
      isShortFormat = false, // MM-dd 형식의 단축 포맷 적용 여부
      yearType, // 평가 주기 타입 ("YEAR", "UPPER", "LOWER")
    ) => {
      const val = row[colIdx];
      const parsedVal = parseDateString(val);
      let isDueMonth = false;

      // 평가 주기 유형에 따른 마감 월 도래 여부 판별 스위치 분기
      switch (yearType) {
        case "YEAR":
          isDueMonth = isAfterPrevMonthFirstDay;
          break;
        case "UPPER":
          isDueMonth = hasDueMonthPassed(planEndDateStr, "UPPER");
          break;
        case "LOWER":
          isDueMonth = hasDueMonthPassed(planEndDateStr, "LOWER");
          break;
        default:
          break;
      }

      // 날짜 데이터로 정상 파싱되는 경우의 처리 분기
      if (parsedVal) {
        const formatted = isShortFormat ? formatToMMdd(parsedVal) : parsedVal;
        return { text: formatted, color: COLOR_POSITIVE };
      } else {
        const strVal = val != null ? String(val).trim() : "";

        // 미작성 상태이거나 값이 비어있는 경우 마감 도래 여부에 따라 색상 지정 분기
        if (strVal === "미작성" || !strVal) {
          return {
            text: "미작성",
            color: isDueMonth ? COLOR_NEGATIVE : COLOR_WHITE,
          };
        }

        // 계약해지나 해당없음 등 예외 상태 문자열인 경우 중립 색상 부여 분기
        if (strVal.includes("계약해지") || strVal.includes("해당없음")) {
          return { text: strVal, color: COLOR_NEUTRAL };
        }
        return { text: strVal, color: COLOR_NEGATIVE };
      }
    };

    // 각 평가 항목별 열 인덱스를 매핑하여 프로세스 함수 호출
    recipientResult.fallUpper = processEvalCell(4, true, "UPPER"); // Col F: 낙상위험도(상반기)
    recipientResult.bedsoresUpper = processEvalCell(6, true, "UPPER"); // Col G: 욕창위험도(상반기)
    recipientResult.cognitionUpper = processEvalCell(8, true, "UPPER"); // Col H: 인지기능(상반기)
    recipientResult.fallLower = processEvalCell(5, true, "LOWER"); // Col I: 낙상위험도(하반기)
    recipientResult.bedsoresLower = processEvalCell(7, true, "LOWER"); // Col J: 욕창위험도(하반기)
    recipientResult.cognitionLower = processEvalCell(9, true, "LOWER"); // Col K: 인지기능(하반기)
    recipientResult.desireEval = processEvalCell(10, true, "YEAR"); // Col L: 욕구사정

    const rawPlanText = row[11]?.toString().trim() ?? ""; // Col L(실제 원본상의 계획서 텍스트 열)
    const matchPublic = rawPlanText.match(/(\d{2,4}[.-]\d{1,2}[.-]\d{1,2})/);

    // 급여제공계획서 미작성 또는 오류 상태인지 확인하는 조건 분기
    if (
      rawPlanText.includes("미작성") ||
      !rawPlanText ||
      rawPlanText.includes("GMT")
    ) {
      recipientResult.planWriteDate = {
        text: "미작성",
        color: isAfterPrevMonthFirstDay ? COLOR_NEGATIVE : COLOR_WHITE,
        link: "",
      };
    } else if (rawPlanText.includes("계약해지")) {
      // 계약해지 상태인 경우 중립 색상 부여 분기
      recipientResult.planWriteDate = {
        text: "계약해지",
        color: COLOR_NEUTRAL,
        link: "",
      };
    } else if (matchPublic) {
      // 날짜 형식이 매칭되는 경우 드라이브 연동 파일과 대조하는 분기
      const formattedDate = parseDateString(matchPublic[1]);
      const driveFile = driveFileMap.get(`${name}_급여제공계획서`);

      // 드라이브 파일 존재 여부 및 날짜 일치 여부를 검증하는 분기
      if (
        driveFile &&
        formattedDate &&
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
          text: `${formattedDate || rawPlanText}\n(파일오류)`,
          color: COLOR_NEGATIVE,
          link: "",
        };
      }
    } else {
      recipientResult.planWriteDate = {
        text: parseDateString(rawPlanText) || rawPlanText,
        color: COLOR_POSITIVE,
        link: "",
      };
    }

    // 계획서 텍스트 내용에 '목욕' 포함 여부에 따라 방문목욕 또는 방문요양으로 서비스 종류 분기
    recipientResult.planType = {
      text: rawPlanText.includes("목욕") ? "방문목욕" : "방문요양",
      color: recipientResult.planWriteDate.color,
    };

    // 전월 첫째 날 경과 여부에 따른 결과평가 작성일자 연산 분기
    if (!isAfterPrevMonthFirstDay) {
      // 전월 첫째 날이 지나지 않은 경우 직전 월 시트의 데이터 유지 분기
      if (prevRecipientData?.resultEvalDate) {
        const cleanResDate =
          parseDateString(prevRecipientData.resultEvalDate.text) ||
          prevRecipientData.resultEvalDate.text;
        recipientResult.resultEvalDate = {
          text: cleanResDate,
          color: COLOR_WHITE,
          link: prevRecipientData.resultEvalDate.link,
        };
      } else {
        recipientResult.resultEvalDate = {
          text: "",
          color: COLOR_WHITE,
          link: "",
        };
      }
    } else {
      // 전월 첫째 날이 지난 경우 드라이브에서 급여제공결과평가 파일 검색 분기
      const driveFile =
        driveFileMap.get(`${name}_급여제공결과평가`) ||
        driveFileMap.get(`${name}_급여제공결과평가(모니터링)`);

      // 드라이브 파일이 존재하고 당해 연도 파일인지 확인하는 분기
      if (driveFile && driveFile.fileDate.startsWith(currentYearStr)) {
        const cleanDriveDate =
          parseDateString(driveFile.fileDate) || driveFile.fileDate;
        recipientResult.resultEvalDate = {
          text: cleanDriveDate,
          color: COLOR_POSITIVE,
          link: driveFile.fileUrl,
        };
      } else {
        recipientResult.resultEvalDate = {
          text: "미작성",
          color: COLOR_NEGATIVE,
          link: "",
        };
      }
    }

    /**
     * 날짜 객체 내부의 텍스트, 링크, 메모 등을 정돈하여 깨끗한 객체로 반환합니다.
     */
    const cleanDateObj = (
      obj, // 원본 날짜 데이터 객체
    ) => {
      // 대상 객체나 텍스트가 없는 경우 빈 기본 객체 반환 분기
      if (!obj || !obj.text)
        return { text: "", color: COLOR_WHITE, link: "", note: "" };
      const parsed = parseDateString(obj.text);
      return {
        text: parsed || obj.text,
        color: COLOR_WHITE,
        link: obj.link || "",
        note: obj.note || "",
      };
    };

    // 인정유효기간 및 비고 데이터 승계를 위한 조건 분기
    if (prevRecipientData?.contractStartDate?.text) {
      // 직전 월 시트에 유효기간 시작일 데이터가 있는 경우 그대로 승계
      recipientResult.contractStartDate = cleanDateObj(
        prevRecipientData.contractStartDate,
      );
      recipientResult.contractEndDate = cleanDateObj(
        prevRecipientData.contractEndDate,
      );
      recipientResult.remark = {
        text: prevRecipientData.remark?.text || "",
        color: COLOR_WHITE,
        note: prevRecipientData.remark?.note || "",
      };
    } else {
      // 직전 월에 데이터가 없어 전년도 시트의 유효기간 데이터를 승계하거나 알 수 없음 처리하는 분기
      recipientResult.contractStartDate =
        prevYearRecipientData?.contractStartDate
          ? cleanDateObj(prevYearRecipientData?.contractStartDate)
          : { text: "알 수 없음", color: COLOR_NEGATIVE };
      recipientResult.contractEndDate = prevYearRecipientData?.contractEndDate
        ? cleanDateObj(prevYearRecipientData?.contractEndDate)
        : { text: "알 수 없음", color: COLOR_NEGATIVE };
      recipientResult.remark = {
        text: prevRecipientData?.remark?.text || "",
        color: COLOR_WHITE,
        note: prevRecipientData?.remark?.note || "",
      };
    }

    // 계획 시작일 텍스트가 존재하는 경우 날짜 문자열 파싱 적용 분기
    if (recipientResult.planStartDate.text)
      recipientResult.planStartDate.text =
        parseDateString(recipientResult.planStartDate.text) ||
        recipientResult.planStartDate.text;

    // 계획 참조 종료일 텍스트가 존재하는 경우 날짜 문자열 파싱 적용 분기
    if (recipientResult.planEndDateRef.text)
      recipientResult.planEndDateRef.text =
        parseDateString(recipientResult.planEndDateRef.text) ||
        recipientResult.planEndDateRef.text;

    // 계획 종료일 텍스트가 존재하는 경우 날짜 문자열 파싱 적용 분기
    if (recipientResult.planEndDate.text)
      recipientResult.planEndDate.text =
        parseDateString(recipientResult.planEndDate.text) ||
        recipientResult.planEndDate.text;
  } catch (rowErr) {
    // 행 연산 중 예외가 발생한 경우 에러 상태로 마킹하고 에러 상세 정보 저장
    recipientResult.isValid = false;
    recipientResult.error = {
      name: name,
      rowNum: rowIndex,
      colName: "행 전체 연산",
      type: "런타임 오류",
      detail: rowErr.stack || rowErr.message,
    };
  }

  return recipientResult;
}

function buildRichText(
  text, // 텍스트 내용
  linkUrl, // 연결할 웹 URL 링크
) {
  const builder = SpreadsheetApp.newRichTextValue().setText(text || "");
  if (linkUrl) builder.setLinkUrl(linkUrl);
  return builder.build();
}

function parseDateString(
  val, // 파싱할 날짜 원본 값 (문자열, Date 객체 등)
) {
  // 값이 존재하지 않을 경우 null을 반환하는 분기
  if (!val) return null;

  // 값이 Date 객체 인스턴스인 경우 포맷팅하여 반환하는 분기
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  const str = String(val).trim();
  const parsedDate = new Date(str);

  // 유효한 날짜 객체이면서 GMT 문자열을 포함하는 경우 포맷팅하여 반환하는 분기
  if (!isNaN(parsedDate.getTime()) && str.includes("GMT")) {
    return Utilities.formatDate(
      parsedDate,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd",
    );
  }

  const match = str.match(/(\d{2,4})[.-](\d{1,2})[.-](\d{1,2})/);

  // 정규식 매칭을 통해 연, 월, 일 단위가 추출되는 경우의 변환 분기
  if (match) {
    let year = match[1];
    if (year.length === 2) year = "20" + year;
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

function formatToMMdd(
  dateStr, // 포맷을 변경할 대상 날짜 문자열
) {
  const parsed = parseDateString(dateStr);

  // 파싱된 날짜가 없는 경우 원본 문자열을 그대로 반환하는 분기
  if (!parsed) return dateStr;

  const parts = parsed.split("-");

  // 연, 월, 일 세 파트로 정상 분할된 경우 월/일 형태로 반환하는 분기
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}`;
  }

  return dateStr;
}

function hasPreviousMonthFirstDayPassed(
  dateStr, // 기준이 되는 날짜 문자열
) {
  const parsed = parseDateString(dateStr);

  // 날짜 파싱에 실패한 경우 false를 반환하는 분기
  if (!parsed) return false;

  const target = new Date(parsed);
  const prevMonthFirstDay = new Date(
    target.getFullYear(),
    target.getMonth() - 1,
    1,
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  prevMonthFirstDay.setHours(0, 0, 0, 0);

  return today >= prevMonthFirstDay;
}

function hasDueMonthPassed(
  dateStr, // 기준 날짜 문자열
  halfYearType, // 상·하반기 구분 타입 ("UPPER", "LOWER")
) {
  const parsed = parseDateString(dateStr);

  // 날짜 파싱에 실패한 경우 false를 반환하는 분기
  if (!parsed) return false;

  const target = new Date(parsed);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prevMonthDate = new Date(
    target.getFullYear(),
    target.getMonth() - 1,
    1,
  );
  const prevMonth = prevMonthDate.getMonth();
  const isPrevMonthUpper = prevMonth >= 0 && prevMonth <= 5;

  const isWithinMonth = (year, monthIndex) => {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return today >= start && today <= end;
  };

  // 상반기 여부에 따른 분기 처리
  if (isPrevMonthUpper) {
    if (halfYearType === "UPPER") {
      return isWithinMonth(
        prevMonthDate.getFullYear(),
        prevMonthDate.getMonth(),
      );
    } else if (halfYearType === "LOWER") {
      const target5Month = new Date(
        target.getFullYear(),
        target.getMonth() + 5,
        1,
      );
      return isWithinMonth(target5Month.getFullYear(), target5Month.getMonth());
    }
  } else {
    if (halfYearType === "UPPER") {
      const target7Month = new Date(
        target.getFullYear(),
        target.getMonth() - 7,
        1,
      );
      return isWithinMonth(target7Month.getFullYear(), target7Month.getMonth());
    } else if (halfYearType === "LOWER") {
      return isWithinMonth(
        prevMonthDate.getFullYear(),
        prevMonthDate.getMonth(),
      );
    }
  }

  return false;
}

function extractDriveIdFromUrl(
  url, // 구글 드라이브 폴더 또는 파일 URL 문자열
) {
  // URL이 비어있는 경우 null을 반환하는 분기
  if (!url) return null;

  const str = String(url).trim();
  const match = str.match(/folders\/([a-zA-Z0-9_-]+)/);

  // URL 내 폴더 ID 패턴이 매칭되는 경우 반환하는 분기
  if (match && match[1]) {
    return match[1];
  }

  // 문자열 자체가 드라이브 ID 형식인 경우 그대로 반환하는 분기
  if (str.length >= 25 && /^[a-zA-Z0-9_-]+$/.test(str)) {
    return str;
  }

  const generalMatch = str.match(/([a-zA-Z0-9_-]{25,})/);
  return generalMatch ? generalMatch[1] : str;
}

function cacheDriveFilesRecursive(
  folder, // 탐색할 구글 드라이브 폴더 객체
  map, // 파일 정보를 저장할 메타데이터 맵 객체
) {
  const files = folder.getFiles();

  // 현재 폴더 내 파일들을 순회하며 캐싱하는 반복문
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);

    // 파일 이름에 날짜 패턴이 포함되어 있는 경우 맵에 등록하는 분기
    if (dateMatch) {
      const parentFolder = folder.getName().replace(/\s+/g, "").trim();
      const key = `${parentFolder}_${fileName.split("_")[1] || fileName}`;
      const fileDate = dateMatch[1];

      const existing = map.get(key);

      // 기존에 등록된 파일이 없거나 새로운 파일의 날짜가 더 최신인 경우 갱신하는 분기
      if (!existing || existing.fileDate < fileDate) {
        map.set(key, {
          fileName: fileName,
          fileUrl: file.getUrl(),
          fileDate: fileDate,
        });
      }
      map.set(fileName, {
        fileName: fileName,
        fileUrl: file.getUrl(),
        fileDate: fileDate,
      });
    }
  }

  const subFolders = folder.getFolders();

  // 하위 폴더들을 재귀적으로 순회하며 탐색하는 반복문
  while (subFolders.hasNext()) {
    cacheDriveFilesRecursive(subFolders.next(), map);
  }
}

function addLog(
  logsArray, // 로그를 누적할 배열 객체
  recipientName, // 대상 수급자 이름
  rowNum, // 발생 행 번호
  colName, // 대상 열 이름
  issueType, // 이슈 유형
  detail, // 상세 내용
) {
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

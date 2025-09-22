import * as Excel from "exceljs/dist/exceljs.min.js";
import { saveAs } from "file-saver";

// 여러 엑셀 시트를 포함하는 하나의 workbook(단위) 생성
const wb = new Excel.Workbook();

// 엑셀 sheet 생성
const sheet = wb.addWorksheet("test");
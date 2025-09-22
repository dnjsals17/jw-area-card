const express = require('express');
const Excel = require('exceljs');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

app.post('/create-excel', async (req, res) => {
    try {
        const { fileName, sheetName, columns } = req.body;

        if (!fileName || !sheetName || !columns || !Array.isArray(columns)) {
            return res.status(400).send('Invalid input data');
        }

        const wb = new Excel.Workbook();
        const sheet = wb.addWorksheet(sheetName);

        // Add columns to the first row
        sheet.getRow(1).values = columns;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}.xlsx`);

        await wb.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating Excel file');
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
import * as Excel from "exceljs/dist/exceljs.min.js";
import { saveAs } from "file-saver";

// 여러 엑셀 시트를 포함하는 하나의 workbook(단위) 생성
const wb = new Excel.Workbook();

// 엑셀 sheet 생성
const sheet = wb.addWorksheet("test");
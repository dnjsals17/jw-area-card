const MAX_LIMIT = 5000;

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname)));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'yourdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// POST /api/addresses/in-polygon
app.post('/api/addresses/in-polygon', async (req, res) => {
  try {
    const {
      coordinates,
      sidonm,
      sggnm,
      emdnm,
      onlyMissing,
      limit
    } = req.body || {};

    // 1) 좌표 검증
    if (!Array.isArray(coordinates) || coordinates.length < 3) {
      return res.status(400).json({ error: 'coordinates_must_have_at_least_3_points' });
    }

    // 2) WKT POLYGON 문자열 만들기 (lng lat 순서, 폐합 링)
    const ring = coordinates.map(({ lat, lng }) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new Error('invalid_coordinate');
      }
      return `${lng} ${lat}`; // WKT: lng lat
    });
    // 닫힌 링이 아니면 시작점을 마지막에 추가
    if (ring[0] !== ring[ring.length - 1]) {
      ring.push(ring[0]);
    }
    const wkt = `POLYGON((${ring.join(', ')}))`;

    // 3) 조건 조립
    const whereClauses = [];
    const params = [];

    // 좌표 유무 필터
    if (onlyMissing === true || onlyMissing === 'true') {
      whereClauses.push('(a.lat IS NULL OR a.lng IS NULL)');
    } else {
      // 폴리곤 판정은 좌표가 있어야 가능
      whereClauses.push('a.lat IS NOT NULL AND a.lng IS NOT NULL');
    }

    // 행정구역 선택 필터 (선택)
    if (sidonm) { whereClauses.push('b.sido_nm = ?'); params.push(sidonm); }
    if (sggnm) { whereClauses.push('b.sgg_nm = ?');  params.push(sggnm); }
    if (emdnm) { whereClauses.push('b.emd_nm = ?');  params.push(emdnm); }

    // 4) 공간 판정: pt 컬럼이 있으면 그것 사용, 없으면 on-the-fly
    //    - pt 사용: ST_Contains(ST_GeomFromText(?,4326), a.pt)
    //    - on-the-fly: ST_Contains(ST_GeomFromText(?,4326), ST_SRID(POINT(a.lng, a.lat),4326))
    const usePtColumn = false; // pt 컬럼을 만들지 않았다면 false로 바꾸세요.

    // MySQL 5.7 이하 호환
const geomPredicate = 'ST_Contains(ST_GeomFromText(?), POINT(a.lng, a.lat))';

    // const geomPredicate = 'ST_Contains(ST_GeomFromText(?, 4326), ST_Point(a.lng, a.lat, 4326))';

    // const geomPredicate = usePtColumn
    //   ? 'ST_Contains(ST_GeomFromText(?, 4326), a.pt)'
    //   : 'ST_Contains(ST_GeomFromText(?, 4326), ST_SRID(POINT(a.lng, a.lat), 4326))';

    params.unshift(wkt); // 첫 번째 파라미터로 WKT

    const whereSQL = whereClauses.length ? `AND ${whereClauses.join(' AND ')}` : '';

    // 5) LIMIT
    const lim = Math.min(Number(limit) || 1000, MAX_LIMIT);

    const sql = `
      SELECT
        a.mgt_no,
        a.lat, a.lng,
        b.sido_nm, b.sgg_nm, b.emd_nm, b.road_nm,
        CONCAT_WS(' ',
          b.sido_nm, b.sgg_nm, b.emd_nm,
          b.road_nm,
          CONCAT(a.bld_main_no,
            IF(a.bld_sub_no > 0, CONCAT('-', a.bld_sub_no), '')
          )
        ) AS road_addr
      FROM kr_juso.juso_addr a
      JOIN kr_juso.road_name_code b
        ON a.road_cd = b.road_cd
       AND a.emd_seq = b.emd_seq
      WHERE ${geomPredicate}
      ${whereSQL}
      ORDER BY b.road_nm, a.bld_main_no, a.bld_sub_no
      LIMIT ?
    `;

    params.push(lim);

    const [rows] = await pool.query(sql, params);
    res.json({
      count: rows.length,
      items: rows.map(r => ({
        mgt_no: r.mgt_no,
        lat: r.lat,
        lng: r.lng,
        road_addr: r.road_addr
      }))
    });
  } catch (err) {
    console.error(err);
    if (err.message === 'invalid_coordinate') {
      return res.status(400).json({ error: 'invalid_coordinate_value' });
    }
    res.status(500).json({ error: 'failed_to_fetch_in_polygon' });
  }
});

app.get('/api/addresses', async (req, res) => {
  const {
    sidonm = '경기도',
    sggnm = '화성시',
    emdnm = '남양읍',
    onlyMissing
  } = req.query;

  // onlyMissing 값이 "true"면 lat 또는 lng가 없는 것만 필터링
  const onlyMissingCondition = onlyMissing === 'true' ? 'AND (a.lat IS NULL OR a.lng IS NULL)' : '';

  const sql = `
    SELECT
      a.mgt_no, a.road_cd, a.emd_seq,
      a.bld_main_no, a.bld_sub_no, a.zone_no,
      a.lat, a.lng,
      b.sido_nm, b.sgg_nm, b.emd_nm, b.road_nm,
      CONCAT_WS(' ',
        b.sido_nm, b.sgg_nm, b.emd_nm,
        b.road_nm,
        CONCAT(a.bld_main_no,
          IF(a.bld_sub_no > 0, CONCAT('-', a.bld_sub_no), '')
        )
      ) AS road_addr
    FROM kr_juso.juso_addr a
    JOIN kr_juso.road_name_code b
      ON a.road_cd = b.road_cd
     AND a.emd_seq = b.emd_seq
    WHERE b.sido_nm = ? AND b.sgg_nm = ? AND b.emd_nm = ?
    ${onlyMissingCondition}
    ORDER BY b.road_nm, a.bld_main_no, a.bld_sub_no
  `;

  try {
    const [rows] = await pool.query(sql, [sidonm, sggnm, emdnm]);
    res.json({ count: rows.length, items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed_to_fetch' });
  }
});

// 2) 단일 좌표 업데이트
app.post('/api/address/:mgtNo/coords', async (req, res) => {
  const { mgtNo } = req.params;
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat_lng_must_be_numbers' });
  }

  const sql = `
    UPDATE kr_juso.juso_addr
       SET lat = ?, lng = ?
     WHERE mgt_no = ?
  `;
  try {
    const [result] = await pool.query(sql, [lat, lng, mgtNo]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ mgt_no: mgtNo, lat, lng });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed_to_update' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

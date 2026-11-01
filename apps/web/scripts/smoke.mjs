import {
  csv_to_shp,
  kml_to_shp,
  make_boundary_zip,
  parse_kml_content,
} from "@jsr/liuxspro__create-boundary";
import { get_cgcs2000_wkt } from "@jsr/liuxspro__geo";
import proj4 from "proj4";

const csv = `编号,X,Y
1,117.51307,34.307738
2,117.51402,34.307811
3,117.51469,34.307211
4,117.51444,34.306632
5,117.51331,34.30657`;

const { YDMJ, DH, shp } = await csv_to_shp(csv);
console.log("CSV 自动计算 YDMJ / DH:", YDMJ, DH);

const zip = await make_boundary_zip(
  "初步调查",
  {
    DKMC: "测试地块",
    DKDM: "TEST001",
    XZQDM: "340100000000",
    XZQMC: "测试县",
    YDMJ,
    DH,
    SCRQ: new Date(),
    SCDW: null,
    BZ: null,
  },
  shp,
);
console.log("ZIP 字节数:", zip.byteLength);

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>
<outerBoundaryIs><LinearRing><coordinates>
117.5100547556671,34.30576427606589,0 117.5147132511962,34.30537379880738,0
117.5149344642275,34.30902667551095,0 117.5132951535543,34.30915895095126,0
117.5100547556671,34.30576427606589,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;

console.log("KML 多边形数:", parse_kml_content(kml).length);
const kml_result = await kml_to_shp(kml);
console.log("KML 自动计算 YDMJ / DH:", kml_result.YDMJ, kml_result.DH);

const zone = Math.round(117.51307 / 3);
const forward = proj4(get_cgcs2000_wkt(zone)).forward([117.51307, 34.307738]);
const back = proj4(get_cgcs2000_wkt(zone)).inverse(forward);
console.log("投影往返:", forward, "→", back);

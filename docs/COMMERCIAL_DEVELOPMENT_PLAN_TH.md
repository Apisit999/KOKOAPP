# แผนพัฒนา KOKO Studio: รุ่นใช้ฟรีก่อน เชื่อมเว็บและการขายภายหลัง
วันที่: 11 ตุลาคม 2026
ฐานโค้ด: 0.1.26
สถานะ: Free plan ฝั่ง License Server และปุ่มรับสิทธิ์ในโปรแกรมทำแล้ว; API/หน้าเว็บ production, packaged UI verification และฮาร์ดแวร์จริงยังค้าง


## รุ่นแรก: Free Early Access
- ให้ใช้ฟรีโดยเซิร์ฟเวอร์ออก signed entitlement ต่อ installation identifier; แพ็กเกจ Free อนุญาต capture, printing และ templates แบบ local หนึ่ง installation ต่อ identifier
- Free ไม่เปิด cloud_sync จึงสร้างอัลบั้มคลาวด์ไม่ได้ ช่วยคุมต้นทุนรูปออนไลน์; ลูกค้ายังเก็บและส่งออกภาพในเครื่องได้
- แพ็กเกจรายเดือน รายปี และ lifetime เดิมยังคงอยู่ และยังแสดงจาก License Server; checkout, payment webhook และ production issuance สำหรับแพ็กเกจขายยังไม่ได้ทำ
- ตอนนี้การรับ Free ยังไม่ผูกกับบัญชี kokomemory.com และการ build ที่แจกยังไม่มี production API URL/public signing key จึงยังเปิด Free activation ให้ลูกค้าจริงไม่ได้
- รายงานผลล่าสุด: [free-readiness.json](../artifacts/verification/0.1.26/free-readiness.json); typecheck ผ่าน, automated tests 84/84 ผ่าน, Windows build ผ่าน; packaged UI harness ติด ACL ของ AppContainer และไม่ได้รายงานว่าผ่าน

## ความคืบหน้าใน 0.1.26
- ตั้ง PIN 4–12 หลักก่อนเริ่ม Guest mode; Main เก็บ salted hash และจำกัดการลองผิด 5 ครั้ง/พัก 60 วินาที
- ปุ่มกลับ, Escape, ปุ่มคลังภาพ/ตั้งค่าจาก Guest, Alt+F4 และการเปิดแอปซ้ำเรียกหน้าตรวจ PIN; สถานะ kiosk เก็บข้าม process restart
- UI smoke check ผ่าน: ตั้ง PIN, ปฏิเสธ PIN ผิด, ยอมรับ PIN ถูก, ยืนยันว่า status ไม่เปิดเผยค่า PIN และลบข้อมูลทดสอบ
- typecheck ผ่านและ automated tests รุ่น 0.1.26 ผ่าน 84/84; Windows build ผ่าน แต่ renderer harness ของรุ่นนี้ยังติด Windows AppContainer/ACL (ผล 15 checks ของ 0.1.25 เป็นข้อมูลรุ่นก่อน)
- API ออก entitlement Free และปุ่มรับ Free ในหน้า Account ทำแล้ว; packaged build ยังไม่มี production URL/public key จึงรับสิทธิ์จากบริการจริงไม่ได้
- Free claim ยังไม่เชื่อมกับบัญชี kokomemory.com; ยังไม่มีการทดสอบ camera/printer จริง

## เป้าหมายรุ่น Free Early Access
เปิดให้ลูกค้าทดลองใช้งาน local capture, templates และ printing โดยไม่ซื้อแพ็กเกจก่อน เชื่อมเว็บไซต์เพื่อรับบัญชีและสิทธิ์เมื่อมี repo/API deployment แล้ว และระบุอุปกรณ์จริงที่รองรับหลังมีฮาร์ดแวร์

## เป้าหมายรุ่นทดลองขาย
Windows x64 สำหรับผู้รับจัดงานที่มีผู้ดูแลเครื่อง ใช้เว็บแคมที่ผ่านการตรวจจริง และเครื่องพิมพ์รุ่นแรกที่ระบุชัด แขกถ่าย ใส่กรอบ ดูผล พิมพ์ และรับรูปผ่าน QR ได้ ผู้ดูแลติดตั้ง เปิดสิทธิ์ ตั้งค่างาน และแก้ปัญหาได้ตามคู่มือ
เก็บต้นฉบับในเครื่อง ถ่าย/พิมพ์ต่อเมื่ออินเทอร์เน็ตขัดข้อง และส่งรูปเมื่อเครือข่ายกลับมา รูปออนไลน์พร้อมให้ดาวน์โหลดหลังอัปโหลดสำเร็จเท่านั้น

## หลักฐานจุดเริ่มต้น
- แอปมี capture/session, template, guest display, local storage, QR, cloud retry, license verification และ print queue แล้ว
- 0.1.24 baseline ผ่าน automated checks 83 รายการ; รุ่น 0.1.25 ผ่าน typecheck และ packaged harness 15 checks รวม PIN smoke check
- UI harness ใช้โปรไฟล์ไม่มีไลเซนส์ จึงยังไม่ยืนยัน flow ถ่าย/พิมพ์ที่ต้องมีสิทธิ์
- KOKOMEMORY upload ตรวจด้วย mocked contract ยังไม่มีผล staging จริง; ส่ง JPEG ได้ ส่วนการส่งวิดีโอเข้า KOKOMEMORY ยังไม่มี
- cloud album ภายในโปรเจกต์กับแกลเลอรีเว็บไซต์ KOKOMEMORY เป็นคนละเส้นทาง ต้องเลือกเส้นทางหลักสำหรับรุ่นขายและแสดงปลายทางให้ผู้ดูแลเห็นก่อนส่งภาพ
- เซิร์ฟเวอร์มี activation, refresh, deactivate, Free self-claim และ quota/retention; การออกไลเซนส์แบบชำระเงินยังเป็น development-only และตาราง payments ยังไม่ได้เชื่อมผู้ให้บริการรับเงิน
- ตัวติดตั้งยัง unsigned; install/upgrade/uninstall และฮาร์ดแวร์จริงยังค้าง

## P0 — ปิดงานซอฟต์แวร์ Free โดยไม่พึ่งอุปกรณ์ (กรอบ 1–2 สัปดาห์)
1. เพิ่มโหมดพิมพ์จำลองที่เก็บผลเป็นสถานะ simulated แยกจาก Windows submitted เพื่อไม่แสดงว่ามีกระดาษพิมพ์ออกจริง
2. ใช้ built-in sample photos ตรวจ flow Free ตั้งแต่งาน → capture → retake/confirm → composition → คลังภาพ → simulated print → restart recovery
3. ตรวจ Guest PIN, จำกัดการ retake/print ต่อ session, ล้างสถานะแขก และบันทึกสถานะคิวเมื่อแอปปิด
4. ทำรายงาน diagnostics สำหรับพื้นที่ดิสก์ กล้องหลุด คิวพิมพ์ และ upload retry โดยไม่เก็บข้อมูลรูป/secret
5. แก้ packaged UI harness/ACL ให้ตรวจหน้า Free และ capture simulation บน build จริงได้

เกณฑ์จบ: ทดสอบ sample session ในโปรแกรม Free ได้ครบและเปิดภาพ/งานพิมพ์จำลองเดิมหลัง restart ได้ โดยไม่อ้างว่าทดสอบกล้องหรือเครื่องพิมพ์จริงแล้ว

## P1 — เชื่อมบัญชี Free และแกลเลอรี kokomemory.com (กรอบ 1–2 สัปดาห์; เริ่มหลังเข้าถึง repo/staging)
1. ตรวจ repo/ผู้ให้บริการของเว็บไซต์ และเลือกเส้นทาง gallery หลัก โดยใช้ integration ที่มีแล้วเมื่อสอดคล้องกับสิทธิ์และข้อมูล
2. ใช้ booking ทดสอบและ uploader credential ที่มีขอบเขตจำกัด ตรวจ init/upload/confirm และ QR บนมือถือ
3. ให้ผู้ดูแลเห็นชื่องาน/booking/album ที่ผูกไว้ และ snapshot ปลายทางลงคิว เพื่อไม่ให้รูปที่ค้างย้ายไปงานใหม่
4. ทดสอบเน็ตหลุด เปิดใหม่ ส่งซ้ำ และ credential หมดอายุ รวมถึงการแจ้งว่ารูปยังไม่พร้อม
5. เพิ่ม PIN เป็นตัวเลือกสำหรับ album ที่ระบบเราดูแลเอง; บังคับสิทธิ์ฝั่งเซิร์ฟเวอร์ทั้ง listing, preview และ download พร้อมจำกัดการลอง PIN
6. ตรวจบัญชีลูกค้าต่างราย การเพิกถอนลิงก์ อายุรูป quota และการลบข้อมูล โดยยืนยันกับระบบที่เลือกจริง

เกณฑ์จบ: JPEG จากรอบที่ยืนยันเปิด/ดาวน์โหลดบนมือถือได้ ไม่ส่งรูปผิดงาน และลิงก์ที่หมดอายุหรือถูกเพิกถอนเปิด media เดิมไม่ได้
การแก้เว็บจำเป็นต้องมี repo เว็บไซต์ที่เข้าถึงได้ การ deploy production เป็นขั้นแยกหลังตรวจผล staging

## P2 — เปิดขายแพ็กเกจและชำระเงิน (กรอบ 2–3 สัปดาห์; หลัง Free ทดลองใช้)
เริ่มส่วนขายหลังรุ่น Free ผ่านการทดลองใช้ กำหนดราคา/เงื่อนไข และเพิ่ม production issuance กับระบบผู้ดูแล ก่อนต่อ checkout อัตโนมัติ

1. กำหนด product/plan/seat/ระยะสิทธิ์/ระยะออฟไลน์/พื้นที่/อายุเก็บรูป โดยแยกสิทธิ์ใช้ desktop ออกจากต้นทุน cloud
2. เพิ่ม production issuance และ renewal ฝั่งเซิร์ฟเวอร์ แยกจาก development endpoint พร้อมประวัติผู้ดำเนินการและป้องกันคำสั่งซ้ำ
3. เพิ่ม authentication/authorization ของผู้ดูแลสำหรับออกสิทธิ์ ต่ออายุ ย้ายเครื่อง เพิกถอน และแก้แพ็กเกจ
4. เชื่อม order กับการยืนยันรับเงินและสิทธิ์ที่ออก แสดงประวัติคำสั่งซื้อและวันหมดอายุ
5. ตรวจ activation limit, deactivate/reinstall, refresh outage, grace expiry และข้อมูลเวลา/installation identity ที่ต้องเก็บด้วยระบบป้องกันของ OS
6. เพิ่ม onboarding: ติดตั้ง → เปิดสิทธิ์ → ตั้ง storage → ตรวจ camera/printer → สร้างงาน → ทดลองหนึ่งรอบ
7. ระบุการหมดอายุอย่างชัดเจน ไม่ลบภาพเดิมเมื่อสิทธิ์หมด และแจ้งล่วงหน้าก่อนเริ่มงานที่สิทธิ์ออฟไลน์อาจไม่พอ

เกณฑ์จบ: เจ้าของออกและต่อสิทธิ์ให้ลูกค้าจริงได้จาก production flow ที่ตรวจสิทธิ์ผู้ดูแล ลูกค้าเปิดใช้ในเครื่องตามจำนวนที่กำหนด คำสั่งซ้ำไม่สร้างสิทธิ์/อายุเพิ่มซ้ำ
checkout/webhook อัตโนมัติพัฒนาหลังเลือกผู้ให้บริการและกติกาคืนเงิน ใช้ webhook/reconciliation ฝั่งเซิร์ฟเวอร์เป็นหลักฐานการรับเงิน

## P3 — รับรองอุปกรณ์และเตรียมส่งมอบ (เริ่มเมื่อมีกล้อง/เครื่องพิมพ์)
1. ตรวจ fresh install, upgrade จากรุ่นก่อน, uninstall/reinstall และข้อมูลผู้ใช้ที่ต้องคงอยู่
2. ทำ backup/restore ของข้อมูลแอปและภาพแบบสอดคล้องกัน พร้อมตรวจ recovery หลัง process ปิดกะทันหัน
3. เพิ่ม support export ที่ผู้ใช้เลือกส่งได้ ตรวจและตัด token, signed URL, uploader secret และรูปออกจากรายงาน
4. เตรียม signing certificate/บริการ signing แล้วตรวจตัวติดตั้งที่ลงนามจริง
5. ทำ update แบบผู้ดูแลเลือกเวลานอกงาน ตรวจเวอร์ชัน ไฟล์ และ migration; มีช่องทาง rollback ที่รองรับข้อมูลหลังอัปเดต
6. เขียนคู่มือ Thai, รายการอุปกรณ์ที่รองรับ, ขั้นแก้ปัญหา, ช่องทางและเวลาบริการ
7. ทำหน้าเว็บไซต์ขายพร้อมวิดีโอวงจรใช้งาน ราคา/โควตา/อายุรูปที่กำหนดแล้ว ดาวน์โหลด คู่มือ และช่องทางติดต่อ
8. จัดระบบ staging/production, backups และ monitoring ของบริการที่ใช้จริง

เกณฑ์จบ: ลูกค้าใหม่ติดตั้งและทำรอบแรกตามคู่มือได้ มีวิธีกู้ข้อมูล/เวอร์ชัน และข้อจำกัดที่แจ้งตรงกับผลทดสอบ

## P4 — ทดลองกับลูกค้า 3–5 ราย (กรอบ 2–4 สัปดาห์)
- ใช้ชุด PC/camera/printer เดียวกับที่รับรอง ซ้อมงาน 6–8 ชั่วโมงหรือเท่าระยะงานเป้าหมาย
- จำลองเน็ตหลุด กล้องหลุด printer outage app restart และพื้นที่จัดเก็บไม่พอ
- เก็บจำนวนรอบสำเร็จ เวลา capture-to-save เวลา upload และปัญหาที่ผู้ดูแลแก้เองไม่ได้
- กำหนดรายการปัญหาที่ต้องแก้ก่อนเพิ่มจำนวนลูกค้า โดยปัญหารูปหาย รูปผิดงาน สิทธิ์ผิดบัญชี และ recovery ผิดต้องเป็นตัวกั้น release
- เปิดขายกว้างหลังผ่านงานจริงตามหลักฐาน ไม่ใช้ผล automated checks แทนการตรวจอุปกรณ์

## งานที่เลื่อนไปหลังรุ่นทดลองขาย
- Canon/Sony SDK และ remote shutter: ต้องระบุรุ่น/firmware/transport และมีอุปกรณ์จริง
- macOS, phone-as-camera, AI face search/AI effects, photo marketplace, shared team templates และระบบหลายสาขา
- KOKOMEMORY video upload จนกว่าจะตรวจ API/ต้นทุนและความต้องการลูกค้า
- ประกาศรองรับกล้องทุกยี่ห้อ: folder import ไม่ยืนยัน remote shutter

## ข้อมูลที่เจ้าของต้องกำหนดระหว่างพัฒนา
- PC/Windows/webcam และ printer รุ่นแรก พร้อมขนาดกระดาษ
- repo/hosting ของ kokomemory.com และ staging booking สำหรับตรวจ integration
- รูปแบบขาย ระยะสิทธิ์ จำนวนเครื่อง ระยะออฟไลน์ โควตาและอายุรูป
- ช่องทางรับเงิน การต่ออายุ/คืนเงิน และช่องทางบริการลูกค้า
- งบและบัญชีสำหรับ signing, hosting และระบบ production

## ลำดับพัฒนาต่อจากรุ่น 0.1.26
1. ทำโหมดพิมพ์จำลองและรันทดสอบ Free capture → review/retake → confirm → composition → simulated print → restart recovery ใน packaged app
2. ตั้ง production License API URL/public key และเชื่อม Free claim กับบัญชี kokomemory.com เมื่อมี source/hosting ของเว็บ
3. ทดสอบงานอัปโหลดและ QR กับ staging booking แล้วให้ Free tier ใช้ local features และกำหนด cloud allowance ก่อนเปิดคลาวด์
4. เพิ่มคำสั่งซื้อ/ชำระเงินจริง ต่ออายุ และระบบผู้ดูแลหลังลูกค้าทดลองแล้วกำหนดราคาและเงื่อนไข
5. ตรวจ install/upgrade และ hardware matrix เมื่อได้ PC, camera และ printer รุ่นเป้าหมาย

กรอบเวลาใช้เพื่อจัดลำดับงาน ยังไม่เป็นกำหนดส่งมอบ: P0–P3 ประมาณ 5–9 สัปดาห์เมื่อมีผู้พัฒนาเต็มเวลา อุปกรณ์และ staging พร้อม; P4 เพิ่ม 2–4 สัปดาห์ และเวลาจัดหาบริการภายนอกอาจทำให้ยาวขึ้น

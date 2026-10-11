# รายงานตรวจความพร้อม KOKO Studio 0.1.27

ตรวจและแก้โค้ดวันที่ 11 ตุลาคม 2026 ใน workspace D:/pKOKO

## ผลสรุป

ตัวแอปผ่าน typecheck และ automated tests 88/88 หลังแก้ไข และ build/package Windows x64 ผ่านขั้น compile/package. ยังไม่พร้อมเปิดให้ลูกค้าทั่วไปใช้งานผ่าน kokomemory.com เพราะไม่มี production License API/trusted key, ยังไม่ได้ทดสอบ activation Free ผ่านบริการจริง, และยังไม่ได้ทดสอบติดตั้งบนเครื่องเป้าหมายหรือกับกล้อง/เครื่องพิมพ์จริง

## แก้ไขรอบนี้

- Free claim สำหรับ installation ที่เคย deactivate จะเปิด activation เดิมกลับ; เพิ่ม regression test ที่ตรวจ API และ LicenseRuntime
- หลัง Offline Grace หมด หากกลับมาออนไลน์จะถาม License Server เพื่อ refresh; เพิ่ม test จำลองเวลาและ server response
- เพิ่ม migration เติม cloud_sync ใน plan paid เดิม โดยเก็บ features อื่นไว้; เพิ่ม test เปิดฐานข้อมูลเดิมแล้วยืนยันค่าหลัง upgrade
- เปลี่ยน URL ภาพตัวอย่างเป็น URL สัมพัทธ์กับหน้าแอป เพื่อไม่อ้าง root ของ drive หลังติดตั้ง
- เพิ่มตัวเลือก Simulate print ที่บันทึกงานเป็นสถานะ simulated ในคิวและไม่เรียก Windows printer; เพิ่ม test การบันทึกและเปิดคิวใหม่

## หลักฐานตรวจ

- TypeScript: ผ่าน (tsc --noEmit)
- Tests: ผ่าน 88/88 จาก 20 ไฟล์
- Windows x64: Electron Forge compile และ package ผ่าน; กำลังสร้าง Squirrel installer รุ่น 0.1.27
- เปิดแอปที่แพ็กแล้วได้และสร้างภาพหน้าจอ Thai UI หลายขนาดได้; UI harness ไม่สร้าง report.json ครบ flow และหยุดที่หน้ากั้น License เนื่องจากไม่ได้กำหนด License service จึงยังยืนยัน UI ครบวงจรไม่ได้
- ไม่ได้ทดสอบ hardware จริง

## ยังต้องทำก่อนเปิด Free ให้ผู้ใช้

1. Deploy License API production พร้อมฐานข้อมูลถาวร, HTTPS, backup/restore, monitoring/rate limit และตั้ง public signing key/API URL ใน release build
2. ทดสอบรับ Free, ปิด/เปิดแอป, reconnect, revoke, cloud denial ผ่าน staging และ UI ที่แพ็กแล้ว; ตรวจ sample photos ถึง save/retake/gallery/export/print simulation
3. ทดสอบ sample photo flow ผ่าน packaged file URL ให้จบ end-to-end; unit tests ไม่ได้ยืนยันการ render/import ภาพ
4. ทดสอบติดตั้ง อัปเกรดจากรุ่นเดิม รักษาข้อมูล ถอนการติดตั้ง และกู้คืนบน Windows รุ่นที่จะประกาศรองรับ
5. ลงลายเซ็น code signing, ทำ release notes และคู่มือติดตั้ง/แก้ปัญหา

## สิ่งที่ยังไม่มี

- สมัคร/เข้าสู่ระบบและผูก entitlement กับบัญชี kokomemory.com ยังไม่มี; Free ใช้ persistent installation identifier
- Checkout, orders, signed payment webhooks, refund/renewal และแจก paid license อัตโนมัติยังไม่มี; ทำหลัง Free ผ่าน pilot
- DSLR shutter โดยตรงยังไม่มี; ตอนนี้รองรับ webcam และ import JPEG จาก camera export folder
- ไม่มีกล้อง/เครื่องพิมพ์ในการทดสอบ. submitted ยืนยันเพียง OS รับงานเข้าคิว; simulated ไม่ได้พิมพ์กระดาษ
- Windows x64 มี installer; macOS targets ยังไม่ผ่านเครื่องจริง/signing/notarization; Linux ไม่มี package target
- ยังไม่มีรายงาน UI harness ที่จบครบทุกหน้าใน build นี้

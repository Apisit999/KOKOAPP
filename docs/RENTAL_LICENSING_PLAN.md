# แผนระบบเช่าโปรแกรม KOKO Photobooth

วันที่: 30 กันยายน 2026  
สถานะ: เสนอออกแบบ; ยังไม่มี licensing backend, activation, payment integration หรือการบังคับสิทธิ์ในแอป

## รูปแบบธุรกิจที่รองรับ

| รูปแบบ | วิธีแปลงเป็นสิทธิ์ใช้งาน | สิ่งที่ต้องตัดสิน |
| --- | --- | --- |
| เช่าตามเวลา | startsAt/expiresAt และจำนวนเครื่องพร้อมกัน | รอบเช่า วันเริ่ม และนโยบายต่ออายุ |
| เช่าต่องาน | สิทธิ์ผูก event และช่วงเวลาทำงาน | ความหมายของหนึ่งงาน การเลื่อนงาน และเครื่องสำรอง |
| สมาชิกเดือน/ปี | entitlement จากรอบสมาชิก และ device seats | แพ็กเกจ ขอบเขต feature และ overdue policy |

ทั้งสามแบบใช้ domain entitlement เดียวกันได้ ช่วงแรกควรเลือกขายหนึ่งรูปแบบให้ flow ชัดเจน แผนยังไม่กำหนดราคา ช่องทางจ่ายเงิน หรือ offline duration แทนผู้ใช้

## เส้นทางลูกค้า

1. สร้างบัญชี/รับคำเชิญ เลือกแพ็กเกจ และสร้าง rental order
2. ชำระเงินหรือได้รับสิทธิ์ทดลอง/สิทธิ์ที่ผู้ดูแลออกให้ตาม policy
3. Backend ยืนยัน entitlement แล้วผู้ใช้เปิดแอปและ activate เครื่อง
4. ตรวจจำนวนเครื่องพร้อมกันและออก signed lease ผูก installation/device ID
5. แอปตรวจ lease ใน Main แสดงวันหมดอายุ เวลาที่ต้องต่ออินเทอร์เน็ต และ feature ที่ใช้งานได้
6. เตรียมงานออนไลน์เพื่อรับ lease ที่ครอบคลุมงานก่อนออกสถานที่
7. ต่ออายุ ย้ายเครื่อง หรือ deactivate ผ่าน service ที่มี audit trail

ใช้ install UUID และ device key เป็น identity หลัก ไม่ใช้ MAC address อย่างเดียว ผู้ใช้ลง Windows ใหม่/เปลี่ยนเครื่องต้องมีเส้นทาง recovery ที่ควบคุมจำนวนเครื่องได้

## โครงสร้างข้อมูลเป้าหมาย

| Entity | ข้อมูลหลัก |
| --- | --- |
| Customer / Account | tenant ID, ผู้ดูแล, contact และ roles |
| Plan / PlanVersion | feature set, รูปแบบคิดสิทธิ์, version และข้อจำกัด |
| RentalOrder | order ID, plan version, ช่วงเวลา, จำนวนเครื่อง และสถานะ |
| Entitlement | สิทธิ์ที่ server ยืนยัน เริ่ม/จบ features และ seat limit |
| DeviceInstallation | device ID, account, public device key, app/OS version และ revokedAt |
| Activation | entitlement/device association และเวลาจอง seat |
| SignedLease | lease ID, product, account/device, issuedAt/startsAt/expiresAt, refreshAfter/offlineUntil, features, key ID และ schema version |
| PaymentRecord | provider reference, order ID, amount/currency และ verified status |
| AuditEvent | ผู้กระทำ เวลาจาก server action และ IDs ที่เกี่ยวข้อง |

จำนวน seats บังคับด้วย transaction/unique constraints ที่ server ไม่ใช้การนับจาก Desktop อย่างเดียว หลีกเลี่ยงการเก็บ photo contents ในฐานข้อมูล licensing

## การตรวจสิทธิ์ใน Desktop

- Server ลงลายเซ็น lease ด้วย private key ที่ไม่ถูกใส่ใน installer; Desktop ตรวจด้วย public key ที่เชื่อถือได้และรองรับ key rotation
- ตรวจ signature ก่อนใช้ payload รวม product, schema, device/account binding, timestamps และ features
- ตรวจสิทธิ์ที่ Main/application service ก่อนเริ่ม session/capture ไม่พึ่งการซ่อนปุ่มใน Renderer
- จำกัด lease payload และรับเฉพาะ schema/algorithm ที่กำหนด; malformed หรือ unknown key ต้องไม่ให้สิทธิ์
- Token และ device private key เก็บผ่านระบบปกป้อง credential ของ OS ที่ตรวจพร้อมใช้งานจริง พร้อมแนวทาง recovery
- Public key ไม่ถือเป็น secret; ห้ามให้ client เลือก trust key จาก payload หรือ response ที่ยังไม่ได้ authenticate
- แยก License Service interface จาก transport/client เพื่อทดสอบออฟไลน์และย้าย backend ได้

ใบอนุญาตออฟไลน์ช่วยลดการแก้ไฟล์ตั้งค่าเพื่อเพิ่มสิทธิ์ แต่ไม่รับประกันป้องกันผู้ดูแลเครื่องที่แก้ binary ได้ทั้งหมด ระดับการป้องกันต้องเหมาะกับรูปแบบเช่าและภาระ support

## นโยบายออฟไลน์และงานที่กำลังทำ

ข้อเสนอให้ยืนยันก่อน C1:

- การ activate ครั้งแรกและการขยายช่วงเช่าต้องออนไลน์
- ใช้ออฟไลน์ได้ถึง `offlineUntil` ที่ server ลงลายเซ็น โดยไม่เกินช่วง entitlement ที่ได้รับอนุมัติ
- `refreshAfter` หมายถึงควร renew; เมื่อเลยเวลานี้แต่ยังไม่ถึง offline deadline แอปแจ้งเตือนและใช้งานตาม lease ต่อได้
- ก่อนเริ่ม event ตรวจว่าช่วง lease ครอบคลุมเวลางาน; หากต้องมี buffer ให้ server ออกสิทธิ์ที่อนุมัติไว้ ไม่ต่อเวลาเองใน client
- เมื่อสิทธิ์หมดระหว่าง capture ที่เริ่มแล้ว ให้บันทึก/กู้คืนผลของ operation นั้นให้ครบ แล้วปิดการเริ่ม session ใหม่ตาม policy
- เปิดดู/ส่งออกภาพเดิมและ recovery ได้เมื่อ lease หมดอายุ โดยไม่ลบ เข้ารหัสล็อก หรืออัปโหลดภาพเพื่อบังคับต่ออายุ
- Server revocation ไม่สามารถถึงเครื่องที่ออฟไลน์ทันที ต้องยอมรับความหน่วงสูงสุดตาม offline deadline และบันทึกเป็นนโยบายธุรกิจ
- ใช้ last trusted server time และ elapsed time เพื่อตรวจ clock rollback; local admin ยังแก้สถานะได้ จึงใช้ online reconciliation และ offline lease ที่จำกัดเวลา

## API ที่ต้องออกแบบใน C2

ยังไม่กำหนด path production รายการนี้เป็น application operations:

| Operation | ผลและเงื่อนไข |
| --- | --- |
| register device | authenticate account, register device key และส่ง recovery rules |
| activate entitlement | จอง seat แบบ atomic และส่ง signed lease; retry ไม่จองซ้ำ |
| renew lease | ตรวจ payment/entitlement/revocation และส่ง lease ใหม่ |
| deactivate / transfer | คืน seat หรือย้ายเครื่องตาม policy; เคสเครื่องหายมี admin recovery |
| get account entitlements | ส่งสิทธิ์ของ account ที่ authenticate เท่านั้น |
| payment webhook | ตรวจลายเซ็น provider และ deduplicate event ก่อนเปลี่ยนสถานะ order |
| admin grant/revoke | role checks, audit และ effective date ที่ชัดเจน |

ต้องมี request IDs, idempotency keys, tenant isolation, rate limits และรูปแบบ error ที่บอกว่าต้อง retry หรือแก้โดยผู้ใช้ โดยไม่ log credential หรือข้อมูลอ่อนไหว

สถานะ paid ไม่ได้เกิดจาก client redirect กลับหน้าชำระเงิน Server เป็นผู้ยืนยันจาก provider และ reconciliation; refund/chargeback มี policy แยกและไม่แก้ entitlement โดยเดาจากหน้า UI

## หน้าจอที่ต้องเพิ่ม

- Desktop: บัญชี/สิทธิ์เช่า, Activate, วันหมดอายุ, offline deadline, เครื่องที่ใช้สิทธิ์ และการช่วยเหลือ
- Customer portal: แพ็กเกจ คำสั่งซื้อ ต่ออายุ รายการเครื่องและย้ายเครื่อง
- Admin portal: ลูกค้า/สิทธิ์/เครื่อง payment reconciliation และ audit trail
- Event readiness: กล้อง storage template/printer และ lease ครอบคลุมงานหรือไม่

Prototype ปัจจุบันยังไม่ล็อกด้วย licensing การเปิด enforce ต้องทำหลัง service และ recovery ผ่าน staging แล้ว พร้อม migration สำหรับลูกค้าทดลองเดิม

## Acceptance tests

- payload/signature ปลอม unknown key ผิด product/device และ timestamps ผิดรูปแบบไม่ได้สิทธิ์
- เวลา boundary: ก่อน startsAt, ที่ expiresAt, เลย refreshAfter, ที่ offlineUntil และ clock rollback
- สองเครื่อง activate seat สุดท้ายพร้อมกัน ได้สิทธิ์ตามจำนวนจริง ไม่มี oversubscription
- renew timeout/retry และ payment webhook ซ้ำไม่สร้าง order/activation/สิทธิ์ซ้ำ
- lease revoked ขณะออนไลน์และ lease เดิมขณะออฟไลน์ให้ผลตาม policy ที่ประกาศ
- อินเทอร์เน็ตขาดและระบบ licensing ล่มระหว่างงาน ไม่ทำให้ภาพที่บันทึกแล้วหาย
- หมดอายุระหว่าง capture: operation เดิมบันทึกได้ session ใหม่ถูกควบคุม ภาพเก่าส่งออกได้
- ลงใหม่ เปลี่ยนเครื่อง เครื่องเสีย และ support-assisted recovery มี audit และ seat counts ถูกต้อง

## ลำดับทำงาน

C1: ยืนยัน policy และ schema → C2: server/lease/device + Desktop → ทดสอบ staging และ recovery → C3: billing/portal → เปิดเช่าทดลองกลุ่มเล็ก → commercial release

ก่อนลงมือ C2 ต้องเลือก hosting, database, domain/TLS, credential ownership และวิธีจัดเก็บ signing key การเลือกนี้ไม่ทำให้ต้องอัปโหลดภาพขึ้น cloud และไม่แตะ `C:\KOKOwedding` โดยอัตโนมัติ

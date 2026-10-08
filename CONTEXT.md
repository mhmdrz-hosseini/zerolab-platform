# CONTEXT — ZeroLab Platform

دامنه‌های دانشی پلتفرم. این سند با کد sync نمی‌شود؛ مرجع تصمیم‌های دامنه (domain) است.

---

## Mold Usage Types — دو مسیر ریخته‌گری کاملاً جدا

دو حالت استفاده از قالب را باید کاملاً جدا کنیم:

- **A) قالب سیلیکونی (Silicone Mold)** → چیزی که داخل آن می‌ریزیم، محصول نهایی را می‌سازد.
- **B) قالب PLA (Direct-to-PLA)** → چیزی که مستقیم داخل قالب PLA می‌ریزیم، **بدون** استفاده از قالب سیلیکونی. PLA فقط نقش قالب rigid را دارد.

در مسیر B محدودیت بیشتر است؛ مادهٔ ریخته‌شده باید داشته باشد: **دمای پایین + واکنش شیمیایی کم + exotherm کم + solvent کم.**

---

### 1) داخل قالب سیلیکونی چه می‌شود ریخت؟

| ماده | نمونه محصول | مناسب؟ |
|---|---|---|
| **گچ / Gypsum / Plaster** | مجسمه، دکور، قاب، relief، ماکت | 🟢 عالی |
| **Jesmonite / Mineral resin** | سینی، زیرلیوانی، گلدان، دکور | 🟢 عالی |
| **بتن ریزدانه / ملات (fine Concrete)** | گلدان، tile، دکور، coaster | 🟢 خوب |
| **Epoxy Resin** | جواهر، فیگور، قطعات تزئینی | 🟢 خوب؛ exotherm باید کنترل شود |
| **Polyurethane Resin** | prototype، قطعه صنعتی، figurine | 🟢 خوب |
| **Wax** | شمع، مدل wax، wax carving | 🟢 برای خود سیلیکون مناسب |
| **Chocolate** | شکلات سفارشی، لوگو، figurine | 🟢 فقط با سیلیکون food-safe |
| **ژله / Gelatin / Agar** | دسر، اشکال خوراکی | 🟢 food-safe |
| **Ice / Water** | یخ سفارشی، لوگو | 🟢 |
| **Soap** | صابون تزئینی | 🟢 بسته به فرمول |
| **Clay / Putty** | ornament، embossing، model | 🟢 |
| **Casting plaster/ceramic slurry خاص** | مدل، ceramic work | 🟡 بسته به process |

---

### 2) مستقیم داخل قالب PLA چه می‌شود ریخت؟

#### خیلی مناسب

| ماده | کاربرد |
|---|---|
| **Silicone rubber** | ساخت همان قالب سیلیکونی اصلی (مسیر A از داخل مسیر B) |
| **Plaster / Gypsum** | مجسمه، relief، مدل |
| **Jesmonite** | homeware، coaster، tray، decor |
| **Water-based mineral casting compounds** | دکور، مدل، prototype |
| **Alginate / hydrogel compounds** | molding / temporary forms |

اینها عموماً بهترین گزینه‌های PLA هستند.

#### قابل استفاده ولی با شرط

**Epoxy Resin** — می‌شود مستقیم داخل PLA ریخت، اما دو مشکل دارد:
1. رزین هنگام cure گرم می‌شود.
2. ممکن است به PLA بچسبد.

پس الزامات:

```text
Low-exotherm epoxy
+
Release agent
+
Sealed PLA surface
```

محصولات: jewelry، decorative objects، small prototypes، keycaps، figurines، badges.

**Polyurethane Resin** — مشابه epoxy: prototype، duplicate part، small functional components، figurine.
ولی بعضی PUها خیلی سریع واکنش می‌دهند و گرم می‌شوند → باید **Material Profile** داشته باشند.

#### Concrete داخل PLA

در ابعاد کوچک 🟢 قابل انجام است: coaster، mini planter، decorative block، tile، small architectural component.

ولی PLA چاپ‌شده معمولاً سطح watertight و smooth ندارد، پس:

```text
PLA print
↓
Seal
↓
Release agent
↓
Concrete / plaster / Jesmonite
```

---

### 3) چیزی که مستقیم داخل PLA نباید ریخت

- **Hot Wax** 🔴 — سیلیکون با wax مشکلی ندارد، اما wax معمولاً در دمایی بالاتر از محدودهٔ امن PLA ریخته می‌شود. برای PLA پیشنهاد نمی‌شود.
- **Hot Chocolate / Candy** ⚠️ — chocolate حدود 30°C است و حرارتی مشکل ندارد، ولی برای **تماس غذایی PLA پرینت‌شده** نباید پیش‌فرض گرفت مناسب است (layer line، pigment، nozzle، filament additives). قاعده: `PLA = tooling؛ Silicone food-safe = food contact surface`.
- **Molten Sugar / Caramel** 🔴 — دما خیلی بالاتر از تحمل PLA.
- **Thermoplastic** (molten PLA، ABS، polyethylene، hot glue داغ) 🔴 — مستقیم داخل PLA mold نه.
- **Molten metal** 🔴 — کاملاً خارج از سیستم PLA؛ حتی silicone خاص high-temperature هم به‌خاطر Jacket PLA محدودیت دارد.

---

### 4) ماتریس سازگاری ماده × قالب

```text
                    Silicone Mold       PLA Mold

Plaster                  ✅                ✅
Jesmonite                 ✅                ✅
Concrete                  ✅                ✅
Epoxy                     ✅                ⚠️
Polyurethane              ✅                ⚠️
Silicone                  ✅                ✅
Soap                      ✅                ⚠️
Chocolate                 ✅                ⚠️ Food
Ice                       ✅                ⚠️
Wax                       ✅                ❌/⚠️
Hot Candy                 ⚠️                ❌
Hot Plastic               ❌                ❌
Metal                     ⚠️ Special        ❌
```

---

### 5) دسته‌بندی محصول برای UI

```text
What do you want to manufacture?

HOME & DECOR
→ Jesmonite
→ Plaster
→ Concrete

ART & COLLECTIBLES
→ Epoxy
→ PU Resin
→ Plaster

FOOD
→ Chocolate
→ Ice
→ Jelly

CRAFT
→ Soap
→ Candle / Wax

PROTOTYPING
→ PU Resin
→ Epoxy
→ Silicone
```

و بعد سیستم خودش تصمیم می‌گیرد:

```text
Material
   ↓
Pour Temperature
   ↓
Peak Cure Temperature
   ↓
Chemical Compatibility
   ↓
Exotherm
   ↓
Silicone or PLA direct casting?
```

**قاعدهٔ کلیدی پلتفرم:** برای PLA فقط `Pour Temperature` را چک نکنید؛ **Peak Cure Temperature** را هم بررسی کنید. ممکن است رزین در 22°C ریخته شود ولی داخل قالب طی واکنش به 60°C برسد.

---

### 6) دامنهٔ مواد نسخهٔ اول (V1)

- **Direct-to-PLA** (5 ماده): **Silicone / Plaster / Jesmonite / fine Concrete / Low-exotherm Resin**
- **Silicone Mold** (دامنهٔ باز): **Resin / Plaster / Jesmonite / Concrete / Soap / Wax / Chocolate / Food / Ice / Prototype materials**

> یادآوری از نقشهٔ lab-v1: سرویس فعلی پلتفرم فقط قالب سیلیکونی است؛ دستهٔ Direct-to-PLA یک نوع خدمت آینده است و فعلاً فقط در متن/تاکسونومی جا می‌گیرد، ساخته نمی‌شود.

---

## واژه‌نامهٔ استودیو قالب (Mold Studio Glossary)

واژگان canonical فارسی ↔ اصطلاح MoldForge — مرجع واحد UI استودیو (کاتالوگ کامل: `src/config/mold-params.ts`):

| فارسی (canonical) | MoldForge / انگلیسی | کلید |
|---|---|---|
| قالب جعبه‌ریزهٔ سیلیکونی | Silicone Pour Box | `box_style=POUR_BOX` |
| قالب پرینت مستقیم | Direct Printed Mold | `box_style=SOLID` |
| سینی ریختگی | Tray / Open Pour | `box_style=TRAY` |
| پوستهٔ چاپی | Printed Shell | `shell_wall` |
| حلقهٔ ریختن (قیف) | Sprue / Pour Funnel | `sprue` |
| گلوگاه | Throat | `sprue_radius` |
| راه‌گاه هوا | Air Vent | `vent_count` / `vent_radius` |
| درز قالب / صفحهٔ برش | Parting Seam / Plane | `split_axis` / `contoured` |
| پین هم‌راستایی | Alignment Key | `key_count` / `registration` |
| بال بستن | Clamp Wing | `wings` |
| فلنج پایه | Mounting Flange | `base_flange` |
| صفحهٔ کف جداشدنی | Detachable Key Plate | `base_plate` |
| لقی مونتاژ | Fit Clearance | `fit_clearance` |
| ترمیم مدل | Heal Mesh | `heal` |
| رمش امن | Safe (Voxel) Remesh | `voxel_safe` |
| کاهش مثلث‌ها | Decimate | `decimate` |
| متریال ریختگی | Cast Material/Preset | `cast_preset` |
| تعداد قطعات قالب | Mold Pieces | `parts_count` |
| ضخامت سیلیکون | Silicone/Wall Thickness | `wall_thickness` |

تصمیم‌های واژه‌ای: «جعبه‌ریزه» (نه «جعبه‌ریز») برای POUR_BOX؛ «حلقهٔ ریختن» برای funnel/sprue در متن کاربر (در متن فنی sprue حفظ می‌شود)؛ «راه‌گاه هوا» (نه «ونتیلاسیون»)؛ قطعات قالب «تکه/قطعه» شمرده می‌شود نه «پیس».

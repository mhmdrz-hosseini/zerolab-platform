// کاتالوگ محتوای فارسی پارامترهای قالب — نسخهٔ کامل همهٔ ۵۱ پارامتر MoldForge
// + کلیدهای رزرو (model_rotation) + ترجمهٔ فازها و خطاها.
// منبع فنی: mold-engine/webui/static/js/schema.js (آینهٔ دقیق properties.php.panel فورج).
//   - key/valueها عیناً به انجین فرستاده می‌شوند؛ فقط برچسب‌ها فارسی‌اند.
//   - tier: "essential" = چهار پارامتر اصلی استودیو (تصمیم تیکت ۰۳)؛ بقیه در جمع «پیشرفته».
//   - شرط‌های نمایش (when) در UI از schema.js فورج بازتولید می‌شوند، اینجا فقط دادهٔ محتواست.

export type MoldParamType = "enum" | "bool" | "int" | "float" | "rotation3";
export type MoldParamTier = "essential" | "advanced";
export type MoldParamGroup =
  | "mold"
  | "tray"
  | "split"
  | "sprue"
  | "mesh"
  | "material"
  | "transform";

export type MoldOption = { value: string; label: string };

export type MoldParamSpec = {
  key: string;
  type: MoldParamType;
  def: string | number | boolean | [number, number, number];
  min?: number;
  max?: number;
  step?: number;
  /** unit for display: mm | deg (درجه) | gml (گرم بر میلی‌لیتر) | count (تعداد) */
  unit?: "mm" | "deg" | "gml" | "count";
  options?: MoldOption[];
  label: string;
  hint: string;
  knowMore: string;
  tier: MoldParamTier;
  group: MoldParamGroup;
  /** کلید وب‌-اختصاصی که پیش از رسیدن به افزونه pop می‌شود (model_scale/model_rotation) */
  reserved?: boolean;
};

export const MOLD_PARAM_GROUPS: Record<MoldParamGroup, string> = {
  mold: "قالب و بدنه",
  tray: "تنظیمات سینی",
  split: "برش و بستن قطعات",
  sprue: "حلقهٔ ریختن و راه‌گاه هوا",
  mesh: "آماده‌سازی مدل",
  material: "چگالی متریال‌ها",
  transform: "جهت‌دهی مدل",
};

export const MOLD_PARAMS: MoldParamSpec[] = [
  // ---------- اصلی (essential) ----------
  {
    key: "box_style",
    type: "enum",
    def: "POUR_BOX",
    options: [
      { value: "POUR_BOX", label: "جعبه‌ریزهٔ سیلیکونی" },
      { value: "SOLID", label: "قالب پرینت مستقیم" },
      { value: "TRAY", label: "سینی ریختگی" },
    ],
    label: "نوع قالب",
    hint: "خروجی نهایی چه نوع قالبی باشد.",
    knowMore:
      "سه خروجی اساساً متفاوت وجود دارد. «جعبه‌ریزهٔ سیلیکونی»: دور مدل شما یک پوستهٔ چاپی ساخته می‌شود، داخلش را سیلیکون می‌ریزید تا قالب سیلیکونی واقعی شکل بگیرد؛ بعد با همان سیلیکون بی‌نهایت بار محصول می‌ریزید — بهترین کیفیت سطح و ماندگاری، انتخاب پیش‌فرض ما. «پرینت مستقیم»: خود قطعهٔ پرینت‌شده نقش قالب را دارد؛ سریع‌تر و ارزان‌تر است ولی فقط با متریال‌های کم‌حرارت (موم، گچ، Jesmonite) سازگار است. «سینی ریختگی»: برای مدل‌های تخت با جزئیات یک‌طرفه؛ سیلیکون روی مدل داخل یک سینی باز ریخته می‌شود.",
    tier: "essential",
    group: "mold",
  },
  {
    key: "cast_preset",
    type: "enum",
    def: "CUSTOM",
    options: [
      { value: "CUSTOM", label: "سفارشی" },
      { value: "URETHANE", label: "رزین یورتان" },
      { value: "EPOXY", label: "رزین اپوکسی" },
      { value: "POLYESTER", label: "رزین پلی‌استر" },
      { value: "PLASTER", label: "گچ" },
      { value: "WAX", label: "موم / واکس" },
      { value: "CONCRETE", label: "بتن" },
    ],
    label: "متریال ریختگی",
    hint: "چه چیزی داخل قالب می‌ریزید؛ برآورد وزن و حجم بر همین اساس.",
    knowMore:
      "این انتخاب فقط چگالی متریال را برای محاسبهٔ گرم سیلیکون و متریال لازم پر می‌کند و روی هندسهٔ قالب اثری ندارد. اگر متریال شما در فهرست نیست، «سفارشی» را برگزینید و چگالی را از دیتاشیت وارد کنید (رزین ≈ ۱٫۱، گچ ≈ ۱٫۸، موم ≈ ۰٫۹ گرم بر میلی‌لیتر). برای قالب پرینت مستقیم به جدول سازگاری دقت کنید: متریال با دمای بالا یا گرمای واکنش زیاد برای PLA مناسب نیست.",
    tier: "essential",
    group: "material",
  },
  {
    key: "parts_count",
    type: "int",
    def: 2,
    min: 2,
    max: 4,
    unit: "count",
    label: "تعداد قطعات قالب",
    hint: "۲ = قالب دو تکهٔ استاندارد؛ ۳ تا ۴ برای مدل‌های قفل‌شده در همهٔ جهات.",
    knowMore:
      "قالب دو تکه معمولاً همان چیزی است که می‌خواهید: دو نیمه که در «درز قالب» به هم می‌نشینند و پین‌های هم‌راستایشان جلوگیری از جابه‌جایی می‌کند. اگر مدل شما در هر جهتی قفل شده باشد (مثلاً یک توپ با حلقهٔ وسط)، قالب دو تکه هرگز باز نمی‌شود؛ با ۳ یا ۴ قطعه، مدل مانند برش‌های کیک به گوه‌های شعاعی تقسیم می‌شود تا هر قطعه مستقیم بیرون بیاید.",
    tier: "essential",
    group: "split",
  },
  {
    key: "wall_thickness",
    type: "float",
    def: 3,
    min: 0.1,
    unit: "mm",
    label: "ضخامت سیلیکون",
    hint: "ضخامت لایهٔ سیلیکونی دور مدل، به میلی‌متر.",
    knowMore:
      "در قالب جعبه‌ریزه این همان فاصلهٔ بین مدل و پوستهٔ چاپی است که با سیلیکون پر می‌شود؛ در قالب پرینت مستقیم یعنی ضخامت دیوارهٔ خود قالب. پیش‌فرض ۳ میلی‌متر برای بیشتر قالب‌های خانگی کافی است؛ برای قالب‌های بزرگ‌تر یا ریختن با فشار (رزین) مقدار ۴ تا ۶ میلی‌متر بادوام‌تر است. کمتر از ۲ میلی‌متر سیلیکون را نازک و شکننده می‌کند.",
    tier: "essential",
    group: "mold",
  },

  // ---------- پیشرفته: قالب و بدنه ----------
  {
    key: "solid_shape",
    type: "enum",
    def: "HUG",
    options: [
      { value: "HUG", label: "چسبیده به مدل" },
      { value: "BLOCK", label: "بلوک ساده" },
    ],
    label: "شکل بدنهٔ قالب مستقیم",
    hint: "شکل بیرونی قالب پرینت مستقیم.",
    knowMore:
      "«چسبیده به مدل» بدنه را با کمترین متریال دور شکل مدل می‌پیچد و سبک‌تر و ارزان‌تر است. «بلوک ساده» یک جعبهٔ مستطیلی می‌سازد که گیرانداختن و بستن آن با گیره ساده‌تر است ولی فیلامن بیشتری می‌برد.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "skin_keys",
    type: "bool",
    def: false,
    label: "پین‌های پوست دستکشی",
    hint: "برای روش پوست نازک + پوستهٔ سخت.",
    knowMore:
      "روش حرفه‌ای «پوست دستکشی»: به‌جای یک تکه سیلیکون ضخیم، فقط یک پوست نازک سیلیکونی دور مدل می‌ماند و یک پوستهٔ چاپی سخت آن را نگه می‌دارد. با فعال‌سازی این گزینه، برجستگی‌های هم‌راستا روی پوست سیلیکونی در جیب‌های پوسته می‌نشینند تا موقع ریختن جابه‌جا نشود. ضخامت سیلیکون را برابر ضخامت پوست موردنظر (مثلاً ۳ میلی‌متر) بگذارید.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "shell_wall",
    type: "float",
    def: 2,
    min: 0.4,
    unit: "mm",
    label: "ضخامت پوستهٔ چاپی",
    hint: "دیوارهٔ قطعهٔ پرینت‌شده در قالب جعبه‌ریزه.",
    knowMore:
      "پوستهٔ چاپی همان جعبه‌ای است که سیلیکون داخلش ریخته می‌شود. ۲ میلی‌متر برای پرینت معمولی خوب است؛ اگر پوسته قرار است فشار سیلیکون یا گیرهٔ محکم تحمل کند، ۳ تا ۴ میلی‌متر مطمئن‌تر است. ضخامت بیشتر یعنی فیلامن و زمان پرینت بیشتر.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "base_style",
    type: "enum",
    def: "FLAT",
    options: [
      { value: "FLAT", label: "کف مسطح (بسته)" },
      { value: "OPEN", label: "کف باز" },
      { value: "FOLLOW", label: "هم‌شکل مدل" },
    ],
    label: "کف قالب",
    hint: "پایین قالب چطور تمام شود.",
    knowMore:
      "«کف مسطح» پایه‌ای صاف و بسته می‌سازد — پرینت ساده‌تر و ایستایی بهتر. «کف باز» پایین قالب را باز می‌گذارد و با «صفحهٔ کف جداشدنی» بسته می‌شود؛ برای وقتی که می‌خواهید از پایین هم جدا کنید. «هم‌شکل مدل» کف را دقیقاً دنبال فرم مدل می‌سازد؛ کم‌حجم‌ترین حالت برای مدل‌های منحنی.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "base_flange",
    type: "bool",
    def: true,
    label: "فلنج پایه",
    hint: "دامنهٔ پیچ‌شدن دور کف مسطح.",
    knowMore:
      "یک دامنهٔ افقی با سوراخ پیچ دور کف قالب می‌سازد تا بتوانید قالب را با پیچ روی یک تخته یا میز محکم کنید؛ برای ریختن رزین یا هر جایی که نباید قالب تکان بخورد بسیار مفید است. فقط با «کف مسطح» کار می‌کند.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "base_plate",
    type: "bool",
    def: false,
    label: "صفحهٔ کف جداشدنی",
    hint: "بستن کف باز با یک قطعهٔ چاپی جدا.",
    knowMore:
      "برای «کف باز»: یک صفحهٔ چاپی جداگانه با زبانه و شیار می‌سازد که مدل در جیب آن می‌نشیند و قالب رویش قفل می‌شود. امکان باز کردن قالب از پایین بدون خراب کردن سیلیکون را می‌دهد.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "fit_clearance",
    type: "float",
    def: 0.3,
    min: 0,
    step: 0.05,
    unit: "mm",
    label: "لقی مونتاژ",
    hint: "فاصلهٔ هر سطحِ درگیر بین قطعات چاپی.",
    knowMore:
      "هر پرینتر کمی خطا دارد؛ این عدد فاصلهٔ امن بین سطوحی است که به هم می‌چسبند یا در هم می‌نشینند (بر حسب هر سطح). اگر قطعات پرینت‌شده‌تان سفت‌تر از حد لازم شدند، این مقدار را کمی زیاد کنید (۰٫۴ تا ۰٫۵). صفر نگذارید — قطعات به هم جوش می‌کنند.",
    tier: "advanced",
    group: "mold",
  },
  {
    key: "flange_width",
    type: "float",
    def: 6,
    unit: "mm",
    label: "پهنای فلنج",
    hint: "چقدر فلنج از بدنه بیرون بزند.",
    knowMore:
      "پهنای دامنهٔ فلنج پایه یا حلقهٔ درز. بیشتر یعنی جای پیچ بیشتر و مونتاژ مطمئن‌تر، ولی فضای پرینت و متریال بیشتر.",
    tier: "advanced",
    group: "mold",
  },

  // ---------- پیشرفته: سینی ----------
  {
    key: "tray_mode",
    type: "enum",
    def: "EMBED",
    options: [
      { value: "EMBED", label: "مدل داخل سینی (مهر سیلیکونی)" },
      { value: "FRAME", label: "فقط قاب (شیء واقعی)" },
    ],
    label: "حالت سینی",
    hint: "سینی چاپی با مدل شما چه کند.",
    knowMore:
      "«مدل داخل سینی»: خودِ مدل چاپ‌شده کف سینی می‌نشیند و سیلیکون رویش ریخته می‌شود تا یک مهر سیلیکونی بسازد. «فقط قاب»: سینی فقط یک دیوارهٔ دور شیء واقعی شما (مثلاً یک سنگ یا مجسمهٔ اصلی) است و سیلیکون مستقیم روی شیء اصلی ریخته می‌شود.",
    tier: "advanced",
    group: "tray",
  },
  {
    key: "tray_up",
    type: "enum",
    def: "AUTO",
    options: [
      { value: "AUTO", label: "خودکار" },
      { value: "Z", label: "رو به بالا (+Z)" },
      { value: "X", label: "رو به X" },
      { value: "Y", label: "رو به Y" },
    ],
    label: "وجه جزئیات",
    hint: "کدام وجه مدل رو به ریختن باشد.",
    knowMore:
      "سمتی از مدل که جزئیات دارد باید رو به بالا باشد چون سیلیکون از بالا ریخته می‌شود؛ حالت خودکار بیشترین سطح مفصل را پیدا می‌کند. اگر انتخاب خودکار با تصور شما فرق داشت، جهت را دستی مشخص کنید.",
    tier: "advanced",
    group: "tray",
  },
  {
    key: "tray_outline",
    type: "enum",
    def: "RECT",
    options: [
      { value: "RECT", label: "مستطیلی" },
      { value: "HUG", label: "هم‌شکل مدل (گرد)" },
    ],
    label: "شکل سینی",
    hint: "فرم بیرونی سینی دور مدل.",
    knowMore:
      "«مستطیلی» ساده‌ترین و مقرون‌به‌صرفه‌ترین شکل برای پرینت و برش است. «هم‌شکل مدل» با فاصلهٔ یکنواخت دور پایهٔ مدل می‌پیچد؛ سیلیکون کمتری می‌برد و ظاهر تمیزتری دارد.",
    tier: "advanced",
    group: "tray",
  },
  {
    key: "tray_wall",
    type: "float",
    def: 2.5,
    min: 0.4,
    unit: "mm",
    label: "دیوارهٔ سینی",
    hint: "ضخامت دیواره‌های سینی چاپی.",
    knowMore:
      "ضخامت دیوارهٔ سینی. ۲٫۵ میلی‌متر برای سیلیکون‌های معمولی کافی است؛ اگر عمق سیلیکون زیاد است (سینی بلند)، دیوارهٔ ضخیم‌تر (۳ تا ۴) تاب نمی‌آورد.",
    tier: "advanced",
    group: "tray",
  },
  {
    key: "tray_floor",
    type: "float",
    def: 3,
    min: 0.4,
    unit: "mm",
    label: "کف سینی",
    hint: "ضخامت کف سینی چاپی.",
    knowMore:
      "کف سینی زیر فشار سیلیکون و وزن متریال است؛ ۳ میلی‌متر استاندارد است. برای قالب‌های بزرگ‌تر ضخیم‌تر کنید.",
    tier: "advanced",
    group: "tray",
  },
  {
    key: "tray_margin",
    type: "float",
    def: 6,
    min: 0,
    unit: "mm",
    label: "حاشیهٔ دور مدل",
    hint: "فاصلهٔ مدل تا دیوارهٔ سینی.",
    knowMore:
      "این فاصله می‌شود ضخامت لبهٔ سیلیکونی دور مدل شما. ۶ میلی‌متر لبهٔ مقاومی می‌سازد؛ کمتر از ۴ میلی‌متر لبه نازک و پارگی می‌شود.",
    tier: "advanced",
    group: "tray",
  },
  {
    key: "tray_depth",
    type: "float",
    def: 5,
    min: 0,
    unit: "mm",
    label: "عمق ریختن",
    hint: "ارتفاع سیلیکون بالاتر از بلندترین نقطهٔ مدل.",
    knowMore:
      "چقدر سیلیکون روی بالاترین نقطهٔ مدل بایستد (ضخامت کل سیلیکون از پایه تا سطح). این همان بخشی است که بعداً سطح بالایی محصول می‌شود؛ ۵ میلی‌متر حداقلِ مطمئن برای یک پشتهٔ مقاوم است.",
    tier: "advanced",
    group: "tray",
  },

  // ---------- پیشرفته: برش و بستن ----------
  {
    key: "wings",
    type: "bool",
    def: true,
    label: "بال‌های بستن",
    hint: "دامنه‌های پیچ‌دار در طول درز برای گیره کردن قطعات.",
    knowMore:
      "بال‌های تمام‌قد در دو طرف درز قالب با سوراخ پیچ می‌سازد تا دو نیمه را با پیچ و مهره محکم به هم ببندید — جایگزین دقیق‌تر و مطمئن‌تر از کش و گیره. اگر فعال نباشد، هم‌راستایی فقط با پین‌ها انجام می‌شود.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "wing_width",
    type: "float",
    def: 8,
    unit: "mm",
    label: "پهنای بال",
    hint: "چقدر بال‌های بستن از بدنه بیرون بزنند.",
    knowMore:
      "پهنای هر بال. باید جا برای سوراخ پیچ و لبهٔ گیره باشد؛ ۸ میلی‌متر برای پیچ M3 کافی است. قالب‌های بزرگ‌تر بالِ پهن‌تر می‌خواهند.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "bolt_diameter",
    type: "float",
    def: 3,
    min: 0.5,
    unit: "mm",
    label: "قطر پیچ",
    hint: "قطر سوراخ‌های پیچ روی بال‌ها و فلنج‌ها.",
    knowMore:
      "اندازهٔ پیچ‌هایی که می‌خواهید بخرید (M3 یعنی ۳ میلی‌متر، رایج‌ترین انتخاب). سوراخ‌ها با همین قطر روی بال‌ها و فلنج پایه ساخته می‌شوند.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "bolt_auto",
    type: "bool",
    def: true,
    label: "چینش خودکار پیچ",
    hint: "تعداد و جای پیچ‌ها خودکار تعیین شود.",
    knowMore:
      "با روشن بودن، موتور ساخت بر اساس ارتفاع بال‌ها به‌طور بهینه تعداد و فاصلهٔ پیچ‌ها را می‌چیند. اگر تعداد دقیقی می‌خواهید، خاموش کنید و «تعداد پیچ در هر طرف» را دستی وارد کنید.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "bolt_count",
    type: "int",
    def: 0,
    min: 0,
    max: 10,
    unit: "count",
    label: "تعداد پیچ در هر طرف",
    hint: "وقتی چینش خودکار خاموش است.",
    knowMore:
      "تعداد دقیق سوراخ پیچ در هر بال یا درز. صفر یعنی اصلاً سوراخ پیچ ساخته نشود.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "split_axis",
    type: "enum",
    def: "AUTO",
    options: [
      { value: "AUTO", label: "خودکار" },
      { value: "X", label: "محور X" },
      { value: "Y", label: "محور Y" },
    ],
    label: "محور برش",
    hint: "دو نیمه در کدام جهت از هم باز شوند.",
    knowMore:
      "حالت خودکار با تحلیل قفل‌شدگی، جهتی را انتخاب می‌کند که مدل بهترین آزادشدگی را دارد و معمولاً درست حدس می‌زند. اگر درز پیشنهادی روی جزئیات مهم مدل افتاد، محور را دستی عوض کنید.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "split_offset",
    type: "float",
    def: 0,
    step: 0.1,
    unit: "mm",
    label: "جابه‌جایی صفحهٔ برش",
    hint: "کشیدن صفحهٔ درز از مرکز (خودکار محدود می‌شود).",
    knowMore:
      "به‌طور پیش‌فرض صفحهٔ برش از وسط مدل می‌گذرد. با این عدد می‌توانید صفحه را روی محور برش جابه‌جا کنید تا مثلاً از یک نقطهٔ اوج یا فرورفتگی مهم رد نشود؛ مقدار به‌طور خودکار محدود می‌شود که هیچ نیمه‌ای ناپدید نشود.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "split_horizontal",
    type: "bool",
    def: false,
    label: "برش افقی اضافه",
    hint: "برای قالب‌های خیلی بزرگ: هر قطعه کوتاه‌تر پرینت شود.",
    knowMore:
      "به‌جای دو نیمهٔ چپ/راست بلند، قالب به‌صورت افقی هم بریده می‌شود (مثل کیک چندطبقه) تا هر قطعه ارتفاع کمتری برای پرینت داشته باشد. درز افقی یک حلقهٔ فلنج پیچ‌دار می‌گیرد. فقط برای مدل‌های بلند که از ارتفاع صفحهٔ پرینت می‌زنند لازم است.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "split_z_offset",
    type: "float",
    def: 0,
    step: 0.1,
    unit: "mm",
    label: "ارتفاع درز افقی",
    hint: "جابه‌جایی درز افقی از نیمهٔ ارتفاع.",
    knowMore:
      "وقتی برش افقی فعال است، جای حلقهٔ درز را از وسط ارتفاع بالا یا پایین بکشید؛ مثلاً تا درز روی یک لبهٔ طبیعی مدل بیفتد. مقدار خودکار محدود می‌شود.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "contoured",
    type: "bool",
    def: true,
    label: "درز پیرونده",
    hint: "سطح درز دنبال فرم مدل برود، نه یک صفحهٔ صاف.",
    knowMore:
      "درز پیرونده دقیقاً از وسط پهنای مدل عبور می‌کند و مثل یک پازل خودش را هم‌راستا نگه می‌دارد — بهترین مهر و موم و کمترین نیاز به پین. درز صاف ساده‌تر است ولی به پین هم‌راستایی و بال بستن نیاز دارد.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "key_count",
    type: "int",
    def: 2,
    min: 0,
    max: 4,
    unit: "count",
    label: "پین‌های هم‌راستایی",
    hint: "برجستگی و فرورفتگی روی درز صاف (در حالت گوه‌ای: پین درز).",
    knowMore:
      "پین‌های مخروطی روی سطح درز که موقع بستن قالب، دو نیمه را دقیقاً سر جایشان می‌نشینند و مانع لغزش می‌شوند. با درز پیرونده معمولاً لازم نیست؛ با درز صاف و بدون بال بستن حداقل ۲ پین بگذارید.",
    tier: "advanced",
    group: "split",
  },
  {
    key: "registration",
    type: "enum",
    def: "KEYS",
    options: [
      { value: "KEYS", label: "پین مخروطی" },
      { value: "TEETH", label: "دندانه‌های درگیر" },
    ],
    label: "نوع هم‌راستایی",
    hint: "شکل ویژگی‌های هم‌راستا روی درز صاف.",
    knowMore:
      "«پین مخروطی» کلاسیک و مطمئن است. «دندانه‌های درگیر» لبه‌های زیگزاگی می‌سازد که در هم قفل می‌شوند و سطح تماس بیشتری دارند؛ برای قالب‌هایی که فشار ریختن بالاست.",
    tier: "advanced",
    group: "split",
  },

  // ---------- پیشرفته: حلقهٔ ریختن و راه‌گاه هوا ----------
  {
    key: "sprue",
    type: "bool",
    def: true,
    label: "حلقهٔ ریختن",
    hint: "قیف ریختن از بالای قالب به داخل حفره.",
    knowMore:
      "یک قیف با گلوگاه باریک که از سطح بالای قالب تا حفرهٔ داخلی ادامه دارد؛ متریال را داخلش می‌ریزید تا هم جای ریختن داشته باشد هم فشار هیدرواستاتیک متریال را کامل کردن جزئیات بالا را تضمین کند. برای اکثر قالب‌ها روشن بماند.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "sprue_radius",
    type: "float",
    def: 4,
    min: 0.3,
    unit: "mm",
    label: "شعاع گلوگاه",
    hint: "شعاع دهانهٔ باریک ورودی قالب.",
    knowMore:
      "قطر گلوگاه تعیین می‌کند متریال با چه سهولتی وارد قالب شود؛ موم و رزین غلیظ گلوگاه بزرگ‌تر می‌خواهند. مقدار به‌طور خودکار به حداکثر ممکن محدود می‌شود (حدود ۳۰٪ نصف عرض قالب) و اگر بیشتر بزنید به همان سقف برمی‌گردد.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "big_throat",
    type: "bool",
    def: false,
    label: "گلوگاه بزرگ",
    hint: "عبور سقف خودکار گلوگاه (تا ~۴۵٪ نصف عرض).",
    knowMore:
      "سقف پیش‌فرض برای این است که دور گلوگاه دیوارهٔ کافی بماند. اگر متریال شما خیلی غلیظ است و گلوگاه عادی کافی نیست، این گزینه سقف را تا حدود ۴۵٪ نصف عرض قالب بالا می‌برد — به قیمت دیوارهٔ نازک‌تر دور سوراخ.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "funnel_height",
    type: "float",
    def: 12,
    min: 1,
    unit: "mm",
    label: "ارتفاع قیف",
    hint: "چقدر قیف بالاتر از سطح قالب بایستد.",
    knowMore:
      "ارتفاع برجستگی قیف بالای قالب؛ مثل قیف مایع هر چه بلندتر باشد، فشار بیشتری برای پر شدن گوشه‌ها ایجاد می‌کند (مخصوصاً برای موم). ۱۲ میلی‌متر نقطهٔ شروع خوبی است.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "sprue_flare",
    type: "float",
    def: 2.4,
    min: 1,
    max: 4,
    step: 0.1,
    label: "بازشدگی دهانه",
    hint: "دهانهٔ قیف چند برابر گلوگاه باشد.",
    knowMore:
      "۱ یعنی لولهٔ صاف (ریختن سخت)؛ عدد بزرگ‌تر دهانهٔ گشادتری برای ریختن بدون ریختن بیرون متریال می‌سازد. سقف خودکار دارد تا از بدنهٔ قالب بیرون نزند.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "big_mouth",
    type: "bool",
    def: false,
    label: "دهانهٔ بزرگ",
    hint: "عبور سقف بازشدگی قیف (تا ~۴۵٪ نصف عرض).",
    knowMore:
      "مثل گلوگاه بزرگ ولی برای دهانهٔ بالایی قیف؛ اجازه می‌دهد دهانه از سقف امن بزرگ‌تر شود که ممکن است کمی از لبهٔ قالب بیرون بزند.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "sprue_count",
    type: "int",
    def: 1,
    min: 1,
    max: 4,
    unit: "count",
    label: "تعداد نقاط ریختن",
    hint: "چند قیف ریختن ساخته شود.",
    knowMore:
      "برای مدل‌های بلند یا چندبرجستگی، چند نقطهٔ ریختن باعث می‌شود متریال همهٔ گوشه‌ها را با فشار یکسان پر کند و حباب نماند. نقطه‌های اضافی بعد از ریختن به‌راحتی تراشیده می‌شوند.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "sprue_place",
    type: "enum",
    def: "TOP",
    options: [
      { value: "XY", label: "مرکز XY" },
      { value: "X", label: "مرکز X" },
      { value: "Y", label: "مرکز Y" },
      { value: "TOP", label: "بلندترین نقطه" },
      { value: "MANUAL", label: "دستی (X/Y)" },
    ],
    label: "جای حلقهٔ ریختن",
    hint: "قیف کجای مدل بنشیند.",
    knowMore:
      "«بلندترین نقطه» انتخاب پیش‌فرض و منطقی است: متریال از بالا به پایین پر می‌کند و هوا را بیرون می‌راند. برای مدل‌هایی با چند قله یا شکل خاص، حالت‌های مرکزی یا دستی در دسترس است.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "sprue_x",
    type: "float",
    def: 0,
    step: 0.5,
    unit: "mm",
    label: "افست X قیف",
    hint: "فاصلهٔ افقی قیف از مرکز مدل (حالت دستی).",
    knowMore:
      "وقتی جای قیف را روی «دستی» گذاشته‌اید، با این عدد قیف را روی محور X از مرکز جابه‌جا کنید.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "sprue_y",
    type: "float",
    def: 0,
    step: 0.5,
    unit: "mm",
    label: "افست Y قیف",
    hint: "فاصلهٔ افقی قیف از مرکز مدل (حالت دستی).",
    knowMore:
      "همان افست X ولی روی محور Y؛ با ترکیب دو عدد هر نقطهٔ دلخواه روی سطح بالای مدل قابل هدف‌گیری است.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "vent_count",
    type: "int",
    def: 0,
    min: 0,
    max: 8,
    unit: "count",
    label: "راه‌گاه‌های هوا",
    hint: "مجراهای باریک برای خروج هوا از نقاط مرتفع حفره.",
    knowMore:
      "هوای حب‌شده علت حباب و ناقص‌ماندن جزئیات است. راه‌گاه هوا یک کانال باریک از نقاط مرتفع حفره به بیرون است که هوا فرار می‌کند و بعد از ریختن به‌راحتی تراشیده می‌شود. برای مدل‌های تند و پیچ‌دار ۲ تا ۴ عدد توصیه می‌شود؛ مشاور خودکار معمولاً لازم بودنش را تشخیص می‌دهد.",
    tier: "advanced",
    group: "sprue",
  },
  {
    key: "vent_radius",
    type: "float",
    def: 1,
    min: 0.2,
    step: 0.1,
    unit: "mm",
    label: "شعاع راه‌گاه هوا",
    hint: "قطر هر مجرای هوا.",
    knowMore:
      "باریک‌تر از این، هوا به‌سختی خارج می‌شود؛ ضخیم‌تر، جای تراشیدن بیشتری می‌گذارد و پشت متریال فرار می‌کند. ۱ میلی‌متر تعادل خوبی است و مثل گلوگاه به سقف خودکار محدود می‌شود.",
    tier: "advanced",
    group: "sprue",
  },

  // ---------- پیشرفته: آماده‌سازی مدل ----------
  {
    key: "heal",
    type: "bool",
    def: true,
    label: "ترمیم مدل",
    hint: "ادغام رئوس تکراری، حذف خرابی‌ها، اصلاح نرمال‌ها.",
    knowMore:
      "مدل‌های خروجی هوش مصنوعی گاهی درگاه‌های تکراری یا نرمال‌های معکوس دارند که الگوریتم قالب را به خطا می‌اندازد. ترمیم این‌ها را قبل از هر کاری صاف می‌کند؛ همیشه روشن بماند مگر اینکه دقیقاً بدانید چرا نه.",
    tier: "advanced",
    group: "mesh",
  },
  {
    key: "decimate",
    type: "bool",
    def: false,
    label: "کاهش مثلث‌ها",
    hint: "سبک‌کردن مدل‌های بسیار سنگین قبل از ساخت.",
    knowMore:
      "اگر مدل میلیون‌ها مثلث داشته باشد ساخت قالب کند و پرخطر می‌شود. کاهش مثلث با حفظ کلیت شکل، مدل را سبک می‌کند. برای قالب، جزئیات ریزتر از حد پرینت اصلاً منتقل نمی‌شود؛ پس افت ظاهری معمولاً محسوس نیست.",
    tier: "advanced",
    group: "mesh",
  },
  {
    key: "decimate_ratio",
    type: "float",
    def: 0.5,
    min: 0.1,
    max: 1,
    step: 0.05,
    label: "نسبت کاهش",
    hint: "چه کسری از مثلث‌ها بماند.",
    knowMore:
      "۰٫۵ یعنی نصف مثلث‌ها حفظ شود. برای قالب‌سازی معمولاً تا ۰٫۳ هم بی‌خطر است چون سطح سیلیکونی جزئیات میکرو را از خودش می‌گیرد.",
    tier: "advanced",
    group: "mesh",
  },
  {
    key: "voxel_safe",
    type: "bool",
    // Default ON: engine-generated TRELLIS models are thin-surfaced and shatter
    // into islands at the pour-box jacket voxel (0.4 × wall offset ≈ 2mm),
    // dead-ending every build with "separate pieces". Safe remesh uses the
    // explicit 1mm voxel instead — proven to build end-to-end.
    def: true,
    label: "رمش امن",
    hint: "بازسازی کامل سطح مدل برای مش‌های به‌هم‌ریخته — برای مدل‌های تولیدی انجین سه‌بعدی روشن بماند.",
    knowMore:
      "اگر مدل سوراخ‌سوراخ یا غیرمنفذ باشد (non-manifold)، هیچ الگوریتم قالبی روی آن کار نمی‌کند. رمش امن کل سطح را با مکعب‌های ریز بازسازی می‌کند و مدل را آب‌بند می‌کند — نجات‌دهندهٔ مدل‌های خراب، به بهای کمی افت جزئیات و چند دقیقه زمان بیشتر.",
    tier: "advanced",
    group: "mesh",
  },
  {
    key: "voxel_size",
    type: "float",
    def: 1,
    min: 0.05,
    step: 0.05,
    unit: "mm",
    label: "اندازهٔ وکسل",
    hint: "دقت بازسازی سطح در رمش امن.",
    knowMore:
      "اندازهٔ مکعب‌های بازسازی؛ کوچک‌تر یعنی جزئیات بیشتر و پردازش کندتر. ۱ میلی‌متر برای اکثر قالب‌ها کافی است؛ فقط برای مدل‌های خیلی ریزدندان کوچک‌تر کنید.",
    tier: "advanced",
    group: "mesh",
  },

  // ---------- پیشرفته: چگالی‌ها ----------
  {
    key: "silicone_preset",
    type: "enum",
    def: "CUSTOM",
    options: [
      { value: "CUSTOM", label: "سفارشی" },
      { value: "DRAGONSKIN", label: "Dragon Skin" },
      { value: "MOLDSTAR", label: "Mold Star" },
      { value: "OOMOO", label: "Oomoo" },
      { value: "ECOFLEX", label: "Ecoflex" },
      { value: "MOLDMAX", label: "Mold Max" },
      { value: "PLATSIL", label: "Platinum RTV" },
    ],
    label: "سیلیکون قالب",
    hint: "برند سیلیکون برای پرکردن خودکار چگالی.",
    knowMore:
      "انتخاب هر برند فقط چگالی مرجع آن را در فیلد چگالی سیلیکون می‌نویسد (برآورد گرم سیلیکون دقیق‌تر شود). روی هندسهٔ قالب اثر ندارد. برای کاربرد خوراکی حتماً سیلیکون پلاتینی food-grade انتخاب کنید.",
    tier: "advanced",
    group: "material",
  },
  {
    key: "silicone_density",
    type: "float",
    def: 1.15,
    min: 0.1,
    max: 5,
    step: 0.01,
    unit: "gml",
    label: "چگالی سیلیکون",
    hint: "گرم بر میلی‌لیتر؛ RTV ≈ ۱٫۱ تا ۱٫۲.",
    knowMore:
      "از این عدد برای گفتن اینکه «چند گرم سیلیکون بخرم» استفاده می‌شود. اکثر سیلیکون‌های قالب‌سازی حول ۱٫۱ تا ۱٫۲ هستند؛ مقدار دقیق روی بستهٔ محصول درج شده است.",
    tier: "advanced",
    group: "material",
  },
  {
    key: "cast_density",
    type: "float",
    def: 1.1,
    min: 0.1,
    max: 5,
    step: 0.01,
    unit: "gml",
    label: "چگالی متریال ریختن",
    hint: "گرم بر میلی‌لیتر؛ رزین ≈ ۱٫۱، گچ ≈ ۱٫۸، موم ≈ ۰٫۹.",
    knowMore:
      "با حجم حفرهٔ قالب ضرب می‌شود تا وزن هر بار محصول را بگوییم (مثلاً برای برآورد هزینهٔ هر شمع). پریست «متریال ریختگی» این فیلد را خودش پر می‌کند.",
    tier: "advanced",
    group: "material",
  },
  {
    key: "plastic_density",
    type: "float",
    def: 1.24,
    min: 0.1,
    max: 5,
    step: 0.01,
    unit: "gml",
    label: "چگالی فیلامن",
    hint: "PLA ≈ ۱٫۲۴، PETG ≈ ۱٫۲۷.",
    knowMore:
      "چگالی متریال پرینت سه‌بعدی شما؛ در محاسبهٔ وزن قطعات چاپی و برآورد قیمت (گرم فیلامن) استفاده می‌شود. PLA پیش‌فرض و رایج‌ترین است.",
    tier: "advanced",
    group: "material",
  },

  // ---------- پیشرفته: جهت‌دهی (کلید رزرو) ----------
  {
    key: "model_rotation",
    type: "rotation3",
    def: [0, 0, 0],
    reserved: true,
    label: "چرخش مدل (X/Y/Z)",
    hint: "چرخش مدل پیش از ساخت قالب، بر حسب درجه.",
    knowMore:
      "مدل شما همان‌طور که از مرحلهٔ سه‌بعدی‌سازی آمده وارد می‌شود و موتور ساخت جهت بهینه را خودش تشخیص می‌دهد؛ فقط اگر مدل کج ایستاده یا می‌خواهید وجه خاصی رو به ریختن باشد، این چرخش‌ها را تغییر دهید. این تنظیمات قبل از رسیدن به الگوریتم روی مش اعمال می‌شود.",
    tier: "advanced",
    group: "transform",
  },
];

// ---------- ایندکس‌ها و مقادیر پیش‌فرض ----------

export const MOLD_PARAM_MAP: Record<string, MoldParamSpec> = Object.fromEntries(
  MOLD_PARAMS.map((p) => [p.key, p])
);

export type MoldParamValue = string | number | boolean | [number, number, number];
export type MoldParamValues = Record<string, MoldParamValue>;

export const MOLD_DEFAULTS: MoldParamValues = Object.fromEntries(
  MOLD_PARAMS.map((p) => [p.key, p.def])
);

export const MOLD_ESSENTIAL_KEYS = MOLD_PARAMS.filter(
  (p) => p.tier === "essential"
).map((p) => p.key);

/** کلیدهای رزرو وب‌-اختصاصی؛ پیش از ارسال به افزونه از params عادی جدا می‌شوند. */
export const MOLD_RESERVED_KEYS = ["model_scale", "model_rotation"] as const;

// سقف‌های هندسی مشترک با الگوریتم (constants.py فورج) — برای نمایش «حداکثر مجاز»
export const MOLD_CAPS = {
  THROAT_CAP: 0.3,
  THROAT_CAP_BIG: 0.45,
  MOUTH_CAP: 0.45,
  MOUTH_CAP_BIG: 1.5,
  VENT_CAP: 0.16,
} as const;

// چگالی پریست‌ها (g/ml) — عین SILICONE_PRESETS/CAST_PRESETS در schema.js فورج
export const MOLD_SILICONE_DENSITIES: Record<string, number> = {
  DRAGONSKIN: 1.07,
  MOLDSTAR: 1.18,
  OOMOO: 1.42,
  ECOFLEX: 1.07,
  MOLDMAX: 1.42,
  PLATSIL: 1.12,
};

export const MOLD_CAST_DENSITIES: Record<string, number> = {
  URETHANE: 1.05,
  EPOXY: 1.15,
  POLYESTER: 1.1,
  PLASTER: 1.8,
  WAX: 0.9,
  CONCRETE: 2.4,
};

// ---------- ترجمهٔ فازهای پیشرفت (عین رشته‌های انجین) ----------

export const MOLD_PHASES_FA: Record<string, string> = {
  "starting Blender": "راه‌اندازی موتور ساخت",
  "importing model": "بارگذاری مدل",
  "starting build": "شروع ساخت قالب",
  "preparing mesh": "آماده‌سازی مدل",
  "building the shell": "ساخت پوستهٔ قالب",
  "orienting the object": "جهت‌دهی مدل",
  "building the tray": "ساخت سینی",
  "adding the pour funnel": "افزودن حلقهٔ ریختن",
  "adding clamp wings": "افزودن بال‌های بستن",
  "carving the cavity": "تراش حفرهٔ قالب",
  "boring funnels & vents": "سوراخ‌کاری قیف‌ها و راه‌گاه‌های هوا",
  "shaping the base": "شکل‌دهی کف قالب",
  "splitting into parts": "برش قالب به قطعات",
  "orienting parts for printing": "جهت‌دهی قطعات برای پرینت",
  finishing: "پرداخت نهایی",
  done: "تمام شد",
};

export function moldPhaseFa(phase: string | null | undefined): string {
  if (!phase) return "در حال پردازش…";
  return MOLD_PHASES_FA[phase] ?? phase;
}

// ---------- ترجمهٔ کدهای خطا (safety/errors.py) ----------

export const MOLD_ERRORS_FA: Record<string, string> = {
  ERROR_INVALID_PARAMETER: "یکی از تنظیمات ارسالی نامعتبر است.",
  ERROR_INVALID_GEOMETRY:
    "مدل سه‌بعدی قابل پردازش نیست (هندسهٔ خراب یا مختصات نامعتبر).",
  ERROR_UNSUPPORTED_COMPLEXITY:
    "مدل بیش از حد سنگین است؛ «کاهش مثلث‌ها» را در تنظیمات پیشرفته امتحان کنید.",
  ERROR_GEOMETRY_FAILED:
    "موتور ساخت نتوانست قالب را تولید کند؛ پارامترها را ساده‌تر کنید یا «رمش امن» را روشن کنید.",
  ERROR_BOOLEAN_FAILED:
    "یک عملیات هندسی روی این مدل شکست خورد؛ معمولاً با مدل‌های بسیار پیچیده پیش می‌آید.",
  ERROR_MAX_ITERATIONS: "پردازش پس از تکرارهای زیاد متوقف شد.",
  ERROR_NO_PROGRESS: "پردازش به بن‌بست رسید و لغو شد.",
  ERROR_REPEATED_FAILURE:
    "خطای تکراری در عملیات هندسی؛ مدل ساده‌تر یا «رمش امن» را امتحان کنید.",
  ERROR_PROCESSING_TIMEOUT: "یکی از مراحل ساخت بیش از حد زمان برد.",
  ERROR_JOB_TIMEOUT: "ساخت قالب بیش از زمان مجاز طول کشید.",
  ERROR_MEMORY_LIMIT:
    "حافظهٔ سرور پر شد؛ «کاهش مثلث‌ها» را روشن کنید یا مدل سبک‌تری بسازید.",
  ERROR_BLENDER_CRASH: "موتور ساخت از کار افتاد؛ لطفاً دوباره تلاش کنید.",
  ERROR_INTERNAL: "خطای داخلی سرور؛ لطفاً دوباره تلاش کنید.",
  // کدهای پلتفرم (نه انجین) — ارسال/پولینگ سمت سرور
  ERROR_ENGINE_UNREACHABLE:
    "سرویس ساخت قالب در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید.",
  ERROR_ENGINE_VANISHED:
    "سرویس ساخت قالب دوباره راه‌اندازی شده و کار شما ناتمام ماند؛ اعتبار برگشت داده شد — دوباره تلاش کنید.",
};

export function moldErrorFa(code: string | null | undefined, fallback?: string): string {
  if (!code) return fallback ?? "خطای نامشخص در ساخت قالب.";
  return MOLD_ERRORS_FA[code] ?? fallback ?? code;
}
